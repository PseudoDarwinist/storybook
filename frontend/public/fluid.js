class FluidSimulation {
    constructor(canvas) {
        this.canvas = canvas;
        // Try WebGL2 first, then fall back to WebGL1
        this.gl = canvas.getContext('webgl2') || 
                  canvas.getContext('webgl') || 
                  canvas.getContext('experimental-webgl');
        
        // Store WebGL version for later use
        this.isWebGL2 = !!canvas.getContext('webgl2');
        
        if (!this.gl) {
            console.error('WebGL not supported');
            return;
        }

        this.config = {
            SIM_RESOLUTION: 128,
            DYE_RESOLUTION: 512,
            DENSITY_DISSIPATION: 0.98,
            VELOCITY_DISSIPATION: 0.99,
            PRESSURE_DISSIPATION: 0.8,
            PRESSURE_ITERATIONS: 25,
            CURL: 30,
            SPLAT_RADIUS: 0.25,
            SPLAT_FORCE: 6000,
            SHADING: true,
            COLORFUL: true,
            COLOR_UPDATE_SPEED: 10,
            PAUSED: false,
            BACK_COLOR: { r: 0, g: 0, b: 0 },
            TRANSPARENT: false,
            BLOOM: true,
            BLOOM_ITERATIONS: 8,
            BLOOM_RESOLUTION: 256,
            BLOOM_INTENSITY: 0.8,
            BLOOM_THRESHOLD: 0.6,
            BLOOM_SOFT_KNEE: 0.7,
            SUNRAYS: true,
            SUNRAYS_RESOLUTION: 196,
            SUNRAYS_WEIGHT: 1.0,
        };

        this.pointers = [];
        this.splatStack = [];
        
        this.init();
    }

    init() {
        const gl = this.gl;
        
        // Extension support - store actual extension objects
        const extensions = {
            colorBufferFloat: this.getExtension('WEBGL_color_buffer_float') || this.getExtension('EXT_color_buffer_float'),
            textureHalfFloat: this.getExtension('OES_texture_half_float'),
            textureFloat: this.getExtension('OES_texture_float'),
            textureHalfFloatLinear: this.getExtension('OES_texture_half_float_linear'),
            textureFloatLinear: this.getExtension('OES_texture_float_linear')
        };
        
        // Set up format constants based on WebGL version and extensions
        const ext = {};
        
        if (this.isWebGL2) {
            // WebGL2 has better format support
            ext.formatRGBA = gl.RGBA8;
            ext.internalFormatRGBA = gl.RGBA;
            ext.formatRG = gl.RG8;
            ext.internalFormatRG = gl.RG;
            ext.formatR = gl.R8;
            ext.internalFormatR = gl.RED;
            ext.halfFloatTexType = gl.HALF_FLOAT;
            ext.floatTexType = gl.FLOAT;
        } else {
            // WebGL1 needs to use RGBA for everything
            ext.formatRGBA = gl.RGBA;
            ext.internalFormatRGBA = gl.RGBA;
            ext.formatRG = gl.RGBA; // WebGL1 doesn't have RG format
            ext.internalFormatRG = gl.RGBA;
            ext.formatR = gl.RGBA; // WebGL1 doesn't have R format
            ext.internalFormatR = gl.RGBA;
            
            // Check for half float support
            if (extensions.textureHalfFloat) {
                ext.halfFloatTexType = extensions.textureHalfFloat.HALF_FLOAT_OES;
            } else {
                ext.halfFloatTexType = gl.UNSIGNED_BYTE;
                console.warn('OES_texture_half_float not supported, using UNSIGNED_BYTE');
            }
            
            // Check for float support
            if (extensions.textureFloat) {
                ext.floatTexType = gl.FLOAT;
            } else {
                ext.floatTexType = gl.UNSIGNED_BYTE;
                console.warn('OES_texture_float not supported, using UNSIGNED_BYTE');
            }
        }

        // Final fallback for unsupported formats
        if (!extensions.colorBufferFloat && !this.isWebGL2) {
            console.warn('Float textures not supported, using UNSIGNED_BYTE');
            ext.halfFloatTexType = gl.UNSIGNED_BYTE;
            ext.floatTexType = gl.UNSIGNED_BYTE;
        }

        this.ext = ext;

        // Shaders
        this.programs = this.createPrograms();
        
        // Framebuffers
        this.createFramebuffers();
        
        // Start render loop
        this.lastUpdateTime = Date.now();
        this.colorUpdateTimer = 0.0;
        this.render();
    }

    getExtension(name) {
        const ext = this.gl.getExtension(name);
        if (!ext) {
            console.debug(`Extension ${name} not supported`);
        }
        return ext;
    }

    createPrograms() {
        const gl = this.gl;
        
        // Vertex shader (same for all programs)
        const vertexShader = `
            precision highp float;
            attribute vec2 aPosition;
            varying vec2 vUv;
            varying vec2 vL;
            varying vec2 vR;
            varying vec2 vT;
            varying vec2 vB;
            uniform vec2 texelSize;
            
            void main () {
                vUv = aPosition * 0.5 + 0.5;
                vL = vUv - vec2(texelSize.x, 0.0);
                vR = vUv + vec2(texelSize.x, 0.0);
                vT = vUv + vec2(0.0, texelSize.y);
                vB = vUv - vec2(0.0, texelSize.y);
                gl_Position = vec4(aPosition, 0.0, 1.0);
            }
        `;

        // Display shader
        const displayShader = `
            precision highp float;
            varying vec2 vUv;
            uniform sampler2D uTexture;
            uniform float uAlpha;
            
            void main () {
                vec3 C = texture2D(uTexture, vUv).rgb;
                float a = max(C.r, max(C.g, C.b));
                gl_FragColor = vec4(C, a * uAlpha);
            }
        `;

        // Splat shader
        const splatShader = `
            precision highp float;
            varying vec2 vUv;
            uniform sampler2D uTarget;
            uniform float aspectRatio;
            uniform vec3 color;
            uniform vec2 point;
            uniform float radius;
            
            void main () {
                vec2 p = vUv - point.xy;
                p.x *= aspectRatio;
                vec3 splat = exp(-dot(p, p) / radius) * color;
                vec3 base = texture2D(uTarget, vUv).xyz;
                gl_FragColor = vec4(base + splat, 1.0);
            }
        `;

        // Advection shader
        const advectionShader = `
            precision highp float;
            varying vec2 vUv;
            uniform sampler2D uVelocity;
            uniform sampler2D uSource;
            uniform vec2 texelSize;
            uniform float dt;
            uniform float dissipation;
            
            vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {
                vec2 st = uv / tsize - 0.5;
                vec2 iuv = floor(st);
                vec2 fuv = fract(st);
                vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize);
                vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize);
                vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize);
                vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);
                return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
            }
            
            void main () {
                vec2 coord = vUv - dt * bilerp(uVelocity, vUv, texelSize).xy * texelSize;
                gl_FragColor = dissipation * bilerp(uSource, coord, texelSize);
            }
        `;

        // Divergence shader
        const divergenceShader = `
            precision mediump float;
            varying vec2 vUv;
            varying vec2 vL;
            varying vec2 vR;
            varying vec2 vT;
            varying vec2 vB;
            uniform sampler2D uVelocity;
            
            void main () {
                float L = texture2D(uVelocity, vL).x;
                float R = texture2D(uVelocity, vR).x;
                float T = texture2D(uVelocity, vT).y;
                float B = texture2D(uVelocity, vB).y;
                
                vec2 C = texture2D(uVelocity, vUv).xy;
                if (vL.x < 0.0) { L = -C.x; }
                if (vR.x > 1.0) { R = -C.x; }
                if (vT.y > 1.0) { T = -C.y; }
                if (vB.y < 0.0) { B = -C.y; }
                
                float div = 0.5 * (R - L + T - B);
                gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
            }
        `;

        // Curl shader
        const curlShader = `
            precision mediump float;
            varying vec2 vUv;
            varying vec2 vL;
            varying vec2 vR;
            varying vec2 vT;
            varying vec2 vB;
            uniform sampler2D uVelocity;
            
            void main () {
                float L = texture2D(uVelocity, vL).y;
                float R = texture2D(uVelocity, vR).y;
                float T = texture2D(uVelocity, vT).x;
                float B = texture2D(uVelocity, vB).x;
                float vorticity = R - L - T + B;
                gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
            }
        `;

        // Vorticity shader
        const vorticityShader = `
            precision highp float;
            varying vec2 vUv;
            varying vec2 vL;
            varying vec2 vR;
            varying vec2 vT;
            varying vec2 vB;
            uniform sampler2D uVelocity;
            uniform sampler2D uCurl;
            uniform float curl;
            uniform float dt;
            
            void main () {
                float L = texture2D(uCurl, vL).x;
                float R = texture2D(uCurl, vR).x;
                float T = texture2D(uCurl, vT).x;
                float B = texture2D(uCurl, vB).x;
                float C = texture2D(uCurl, vUv).x;
                
                vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
                force /= length(force) + 0.0001;
                force *= curl * C;
                force.y *= -1.0;
                
                vec2 vel = texture2D(uVelocity, vUv).xy;
                gl_FragColor = vec4(vel + force * dt, 0.0, 1.0);
            }
        `;

        // Pressure shader
        const pressureShader = `
            precision mediump float;
            varying vec2 vUv;
            varying vec2 vL;
            varying vec2 vR;
            varying vec2 vT;
            varying vec2 vB;
            uniform sampler2D uPressure;
            uniform sampler2D uDivergence;
            
            void main () {
                float L = texture2D(uPressure, vL).x;
                float R = texture2D(uPressure, vR).x;
                float T = texture2D(uPressure, vT).x;
                float B = texture2D(uPressure, vB).x;
                float C = texture2D(uPressure, vUv).x;
                float divergence = texture2D(uDivergence, vUv).x;
                float pressure = (L + R + B + T - divergence) * 0.25;
                gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
            }
        `;

        // Gradient subtract shader
        const gradientSubtractShader = `
            precision mediump float;
            varying vec2 vUv;
            varying vec2 vL;
            varying vec2 vR;
            varying vec2 vT;
            varying vec2 vB;
            uniform sampler2D uPressure;
            uniform sampler2D uVelocity;
            
            void main () {
                float L = texture2D(uPressure, vL).x;
                float R = texture2D(uPressure, vR).x;
                float T = texture2D(uPressure, vT).x;
                float B = texture2D(uPressure, vB).x;
                vec2 velocity = texture2D(uVelocity, vUv).xy;
                velocity.xy -= vec2(R - L, T - B);
                gl_FragColor = vec4(velocity, 0.0, 1.0);
            }
        `;

        return {
            display: this.compileShader(vertexShader, displayShader),
            splat: this.compileShader(vertexShader, splatShader),
            advection: this.compileShader(vertexShader, advectionShader),
            divergence: this.compileShader(vertexShader, divergenceShader),
            curl: this.compileShader(vertexShader, curlShader),
            vorticity: this.compileShader(vertexShader, vorticityShader),
            pressure: this.compileShader(vertexShader, pressureShader),
            gradientSubtract: this.compileShader(vertexShader, gradientSubtractShader)
        };
    }

    compileShader(vertexSource, fragmentSource) {
        const gl = this.gl;
        
        const vertexShader = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vertexShader, vertexSource);
        gl.compileShader(vertexShader);

        const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fragmentShader, fragmentSource);
        gl.compileShader(fragmentShader);

        const program = gl.createProgram();
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);

        return program;
    }

    createFramebuffers() {
        const gl = this.gl;
        const ext = this.ext;

        // Create textures
        const simRes = this.getResolution(this.config.SIM_RESOLUTION);
        const dyeRes = this.getResolution(this.config.DYE_RESOLUTION);

        try {
            this.density = this.createDoubleFBO(
                dyeRes.width, 
                dyeRes.height, 
                ext.formatRGBA, 
                ext.internalFormatRGBA, 
                ext.halfFloatTexType, 
                gl.LINEAR, 
                true
            );
            
            this.velocity = this.createDoubleFBO(
                simRes.width, 
                simRes.height, 
                ext.formatRG, 
                ext.internalFormatRG, 
                ext.halfFloatTexType, 
                gl.LINEAR, 
                false
            );
            
            this.divergence = this.createFBO(
                simRes.width, 
                simRes.height, 
                ext.formatR, 
                ext.internalFormatR, 
                ext.halfFloatTexType, 
                gl.NEAREST, 
                false
            );
            
            this.curl = this.createFBO(
                simRes.width, 
                simRes.height, 
                ext.formatR, 
                ext.internalFormatR, 
                ext.halfFloatTexType, 
                gl.NEAREST, 
                false
            );
            
            this.pressure = this.createDoubleFBO(
                simRes.width, 
                simRes.height, 
                ext.formatR, 
                ext.internalFormatR, 
                ext.halfFloatTexType, 
                gl.NEAREST, 
                false
            );
        } catch (error) {
            console.error('Error creating framebuffers:', error);
            throw new Error('WebGL framebuffer creation failed');
        }

        // Create vertex buffer
        this.blit = (() => {
            gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
            
            return () => {
                gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
                gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
                gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
                gl.enableVertexAttribArray(0);
                gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
            };
        })();
    }

    getResolution(resolution) {
        let aspectRatio = this.gl.canvas.width / this.gl.canvas.height;
        if (aspectRatio < 1) aspectRatio = 1.0 / aspectRatio;

        const min = Math.round(resolution);
        const max = Math.round(resolution * aspectRatio);

        if (this.gl.canvas.width > this.gl.canvas.height)
            return { width: max, height: min };
        else
            return { width: min, height: max };
    }

    createFBO(w, h, internalFormat, format, type, filter, wrap) {
        const gl = this.gl;
        
        // Ensure width and height are valid
        if (w <= 0 || h <= 0) {
            console.error('Invalid framebuffer dimensions:', w, h);
            throw new Error('Invalid framebuffer dimensions');
        }
        
        gl.activeTexture(gl.TEXTURE0);
        
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap ? gl.REPEAT : gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap ? gl.REPEAT : gl.CLAMP_TO_EDGE);
        
        // Create texture with proper format
        try {
            gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);
        } catch (error) {
            console.error('Error creating texture:', error);
            // Fallback to RGBA/UNSIGNED_BYTE if texture creation fails
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        }

        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        gl.viewport(0, 0, w, h);
        gl.clear(gl.COLOR_BUFFER_BIT);
        
        // Check framebuffer status
        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (status !== gl.FRAMEBUFFER_COMPLETE) {
            console.error('Framebuffer not complete. Status:', status);
            throw new Error('Framebuffer not complete');
        }

        return {
            texture,
            fbo,
            width: w,
            height: h,
            attach(id) {
                gl.activeTexture(gl.TEXTURE0 + id);
                gl.bindTexture(gl.TEXTURE_2D, texture);
                return id;
            }
        };
    }

    createDoubleFBO(w, h, internalFormat, format, type, filter, wrap) {
        let fbo1 = this.createFBO(w, h, internalFormat, format, type, filter, wrap);
        let fbo2 = this.createFBO(w, h, internalFormat, format, type, filter, wrap);

        return {
            width: w,
            height: h,
            texelSizeX: 1.0 / w,
            texelSizeY: 1.0 / h,
            get read() {
                return fbo1;
            },
            set read(value) {
                fbo1 = value;
            },
            get write() {
                return fbo2;
            },
            set write(value) {
                fbo2 = value;
            },
            swap() {
                const temp = fbo1;
                fbo1 = fbo2;
                fbo2 = temp;
            }
        };
    }

    update() {
        const dt = this.calcDeltaTime();
        if (this.config.PAUSED) return;

        this.updateColors(dt);
        this.applyInputs();
        
        if (!this.config.PAUSED) {
            this.step(dt);
        }
    }

    calcDeltaTime() {
        const now = Date.now();
        let dt = (now - this.lastUpdateTime) / 1000;
        dt = Math.min(dt, 0.016666);
        this.lastUpdateTime = now;
        return dt;
    }

    updateColors(dt) {
        if (!this.config.COLORFUL) return;

        this.colorUpdateTimer += dt * this.config.COLOR_UPDATE_SPEED;
        if (this.colorUpdateTimer >= 1) {
            this.colorUpdateTimer = this.wrap(this.colorUpdateTimer, 0, 1);
            this.pointers.forEach(p => {
                p.color = this.generateColor();
            });
        }
    }

    applyInputs() {
        if (this.splatStack.length > 0) {
            this.multipleSplats(this.splatStack.pop());
        }

        this.pointers.forEach(p => {
            if (p.moved) {
                p.moved = false;
                this.splatPointer(p);
            }
        });
    }

    step(dt) {
        const gl = this.gl;

        gl.disable(gl.BLEND);

        // Curl
        this.curlProgram = this.programs.curl;
        gl.useProgram(this.curlProgram);
        gl.uniform2f(gl.getUniformLocation(this.curlProgram, 'texelSize'), this.velocity.texelSizeX, this.velocity.texelSizeY);
        gl.uniform1i(gl.getUniformLocation(this.curlProgram, 'uVelocity'), this.velocity.read.attach(0));

        this.blit(this.curl);

        // Vorticity
        this.vorticityProgram = this.programs.vorticity;
        gl.useProgram(this.vorticityProgram);
        gl.uniform2f(gl.getUniformLocation(this.vorticityProgram, 'texelSize'), this.velocity.texelSizeX, this.velocity.texelSizeY);
        gl.uniform1i(gl.getUniformLocation(this.vorticityProgram, 'uVelocity'), this.velocity.read.attach(0));
        gl.uniform1i(gl.getUniformLocation(this.vorticityProgram, 'uCurl'), this.curl.attach(1));
        gl.uniform1f(gl.getUniformLocation(this.vorticityProgram, 'curl'), this.config.CURL);
        gl.uniform1f(gl.getUniformLocation(this.vorticityProgram, 'dt'), dt);

        this.blit(this.velocity.write);
        this.velocity.swap();

        // Divergence
        this.divergenceProgram = this.programs.divergence;
        gl.useProgram(this.divergenceProgram);
        gl.uniform2f(gl.getUniformLocation(this.divergenceProgram, 'texelSize'), this.velocity.texelSizeX, this.velocity.texelSizeY);
        gl.uniform1i(gl.getUniformLocation(this.divergenceProgram, 'uVelocity'), this.velocity.read.attach(0));

        this.blit(this.divergence);

        // Clear pressure
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.pressure.read.fbo);
        gl.clear(gl.COLOR_BUFFER_BIT);

        // Pressure
        this.pressureProgram = this.programs.pressure;
        gl.useProgram(this.pressureProgram);
        gl.uniform2f(gl.getUniformLocation(this.pressureProgram, 'texelSize'), this.velocity.texelSizeX, this.velocity.texelSizeY);
        gl.uniform1i(gl.getUniformLocation(this.pressureProgram, 'uDivergence'), this.divergence.attach(0));

        for (let i = 0; i < this.config.PRESSURE_ITERATIONS; i++) {
            gl.uniform1i(gl.getUniformLocation(this.pressureProgram, 'uPressure'), this.pressure.read.attach(1));
            this.blit(this.pressure.write);
            this.pressure.swap();
        }

        // Gradient subtract
        this.gradSubtractProgram = this.programs.gradientSubtract;
        gl.useProgram(this.gradSubtractProgram);
        gl.uniform2f(gl.getUniformLocation(this.gradSubtractProgram, 'texelSize'), this.velocity.texelSizeX, this.velocity.texelSizeY);
        gl.uniform1i(gl.getUniformLocation(this.gradSubtractProgram, 'uPressure'), this.pressure.read.attach(0));
        gl.uniform1i(gl.getUniformLocation(this.gradSubtractProgram, 'uVelocity'), this.velocity.read.attach(1));

        this.blit(this.velocity.write);
        this.velocity.swap();

        // Advect velocity
        this.advectionProgram = this.programs.advection;
        gl.useProgram(this.advectionProgram);
        gl.uniform2f(gl.getUniformLocation(this.advectionProgram, 'texelSize'), this.velocity.texelSizeX, this.velocity.texelSizeY);
        gl.uniform1i(gl.getUniformLocation(this.advectionProgram, 'uVelocity'), this.velocity.read.attach(0));
        gl.uniform1i(gl.getUniformLocation(this.advectionProgram, 'uSource'), this.velocity.read.attach(0));
        gl.uniform1f(gl.getUniformLocation(this.advectionProgram, 'dt'), dt);
        gl.uniform1f(gl.getUniformLocation(this.advectionProgram, 'dissipation'), this.config.VELOCITY_DISSIPATION);

        this.blit(this.velocity.write);
        this.velocity.swap();

        // Advect color
        gl.uniform1i(gl.getUniformLocation(this.advectionProgram, 'uVelocity'), this.velocity.read.attach(0));
        gl.uniform1i(gl.getUniformLocation(this.advectionProgram, 'uSource'), this.density.read.attach(1));
        gl.uniform1f(gl.getUniformLocation(this.advectionProgram, 'dissipation'), this.config.DENSITY_DISSIPATION);

        this.blit(this.density.write);
        this.density.swap();
    }

    render() {
        if (!this.config.PAUSED) {
            this.update();
        }

        const gl = this.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
        
        this.displayProgram = this.programs.display;
        gl.useProgram(this.displayProgram);
        gl.uniform1i(gl.getUniformLocation(this.displayProgram, 'uTexture'), this.density.read.attach(0));
        gl.uniform1f(gl.getUniformLocation(this.displayProgram, 'uAlpha'), 1.0);

        this.blit();

        requestAnimationFrame(() => this.render());
    }

    splat(x, y, dx, dy, color) {
        const gl = this.gl;
        
        this.splatProgram = this.programs.splat;
        gl.useProgram(this.splatProgram);
        gl.uniform1i(gl.getUniformLocation(this.splatProgram, 'uTarget'), this.velocity.read.attach(0));
        gl.uniform1f(gl.getUniformLocation(this.splatProgram, 'aspectRatio'), this.canvas.width / this.canvas.height);
        gl.uniform2f(gl.getUniformLocation(this.splatProgram, 'point'), x, y);
        gl.uniform3f(gl.getUniformLocation(this.splatProgram, 'color'), dx, dy, 0.0);
        gl.uniform1f(gl.getUniformLocation(this.splatProgram, 'radius'), this.correctRadius(this.config.SPLAT_RADIUS / 100.0));

        this.blit(this.velocity.write);
        this.velocity.swap();

        gl.uniform1i(gl.getUniformLocation(this.splatProgram, 'uTarget'), this.density.read.attach(0));
        gl.uniform3f(gl.getUniformLocation(this.splatProgram, 'color'), color.r, color.g, color.b);

        this.blit(this.density.write);
        this.density.swap();
    }

    splatPointer(pointer) {
        const dx = pointer.deltaX * this.config.SPLAT_FORCE;
        const dy = pointer.deltaY * this.config.SPLAT_FORCE;
        this.splat(pointer.texcoordX, pointer.texcoordY, dx, dy, pointer.color);
    }

    multipleSplats(amount) {
        for (let i = 0; i < amount; i++) {
            const color = this.generateColor();
            color.r *= 10.0;
            color.g *= 10.0;
            color.b *= 10.0;
            const x = Math.random();
            const y = Math.random();
            const dx = 1000 * (Math.random() - 0.5);
            const dy = 1000 * (Math.random() - 0.5);
            this.splat(x, y, dx, dy, color);
        }
    }

    generateColor() {
        let c = this.HSVtoRGB(Math.random(), 1.0, 1.0);
        c.r *= 0.15;
        c.g *= 0.15;
        c.b *= 0.15;
        return c;
    }

    HSVtoRGB(h, s, v) {
        let r, g, b, i, f, p, q, t;
        i = Math.floor(h * 6);
        f = h * 6 - i;
        p = v * (1 - s);
        q = v * (1 - f * s);
        t = v * (1 - (1 - f) * s);
        switch (i % 6) {
            case 0: r = v, g = t, b = p; break;
            case 1: r = q, g = v, b = p; break;
            case 2: r = p, g = v, b = t; break;
            case 3: r = p, g = q, b = v; break;
            case 4: r = t, g = p, b = v; break;
            case 5: r = v, g = p, b = q; break;
        }
        return {
            r: r,
            g: g,
            b: b
        };
    }

    correctRadius(radius) {
        const aspectRatio = this.canvas.width / this.canvas.height;
        if (aspectRatio > 1) radius *= aspectRatio;
        return radius;
    }

    wrap(value, min, max) {
        const range = max - min;
        if (range == 0) return min;
        return ((value - min) % range) + min;
    }

    updatePointerDownData(pointer, id, posX, posY) {
        pointer.id = id;
        pointer.down = true;
        pointer.moved = false;
        pointer.texcoordX = posX / this.canvas.width;
        pointer.texcoordY = 1.0 - posY / this.canvas.height;
        pointer.prevTexcoordX = pointer.texcoordX;
        pointer.prevTexcoordY = pointer.texcoordY;
        pointer.deltaX = 0;
        pointer.deltaY = 0;
        pointer.color = this.generateColor();
    }

    updatePointerMoveData(pointer, posX, posY) {
        pointer.prevTexcoordX = pointer.texcoordX;
        pointer.prevTexcoordY = pointer.texcoordY;
        pointer.texcoordX = posX / this.canvas.width;
        pointer.texcoordY = 1.0 - posY / this.canvas.height;
        pointer.deltaX = this.correctDeltaX(pointer.texcoordX - pointer.prevTexcoordX);
        pointer.deltaY = this.correctDeltaY(pointer.texcoordY - pointer.prevTexcoordY);
        pointer.moved = Math.abs(pointer.deltaX) > 0 || Math.abs(pointer.deltaY) > 0;
    }

    updatePointerUpData(pointer) {
        pointer.down = false;
    }

    correctDeltaX(delta) {
        const aspectRatio = this.canvas.width / this.canvas.height;
        if (aspectRatio < 1) delta *= aspectRatio;
        return delta;
    }

    correctDeltaY(delta) {
        const aspectRatio = this.canvas.width / this.canvas.height;
        if (aspectRatio > 1) delta /= aspectRatio;
        return delta;
    }

    blit(target) {
        if (target == null) {
            this.gl.viewport(0, 0, this.gl.canvas.width, this.gl.canvas.height);
            this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
        } else {
            this.gl.viewport(0, 0, target.width, target.height);
            this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, target.fbo);
        }
        
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.gl.createBuffer());
        this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), this.gl.STATIC_DRAW);
        this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, this.gl.createBuffer());
        this.gl.bufferData(this.gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), this.gl.STATIC_DRAW);
        this.gl.vertexAttribPointer(0, 2, this.gl.FLOAT, false, 0, 0);
        this.gl.enableVertexAttribArray(0);
        this.gl.drawElements(this.gl.TRIANGLES, 6, this.gl.UNSIGNED_SHORT, 0);
    }
}

// Only declare FluidSimulation if it doesn't already exist in the global scope
if (typeof window !== 'undefined' && typeof window.FluidSimulation === 'undefined') {
    window.FluidSimulation = FluidSimulation;
}
