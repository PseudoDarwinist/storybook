class FluidSimulation {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        
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
        
        // Extension support
        const ext = {
            formatRGBA: this.getExtension('WEBGL_color_buffer_float') ? gl.RGBA : gl.RGBA,
            formatRG: this.getExtension('WEBGL_color_buffer_float') ? gl.RG : gl.RGBA,
            formatR: this.getExtension('WEBGL_color_buffer_float') ? gl.RED : gl.RGBA,
            halfFloatTexType: this.getExtension('OES_texture_half_float') ? gl.HALF_FLOAT_OES : gl.FLOAT,
            floatTexType: this.getExtension('OES_texture_float') ? gl.FLOAT : gl.HALF_FLOAT_OES
        };

        if (!ext.formatRGBA) {
            ext.formatRGBA = gl.RGBA;
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
        return this.gl.getExtension(name);
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

        this.density = this.createDoubleFBO(dyeRes.width, dyeRes.height, ext.formatRGBA, ext.formatRGBA, ext.halfFloatTexType, gl.LINEAR, true);
        this.velocity = this.createDoubleFBO(simRes.width, simRes.height, ext.formatRG, ext.formatRG, ext.halfFloatTexType, gl.LINEAR, false);
        this.divergence = this.createFBO(simRes.width, simRes.height, ext.formatR, ext.formatR, ext.halfFloatTexType, gl.NEAREST, false);
        this.curl = this.createFBO(simRes.width, simRes.height, ext.formatR, ext.formatR, ext.halfFloatTexType, gl.NEAREST, false);
        this.pressure = this.createDoubleFBO(simRes.width, simRes.height, ext.formatR, ext.formatR, ext.halfFloatTexType, gl.NEAREST, false);

        // Create reusable vertex buffer (fix for performance and potential buffer issues)
        this.vertexBuffer = gl.createBuffer();
        this.indexBuffer = gl.createBuffer();
        
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
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
        gl.activeTexture(gl.TEXTURE0);
        
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap ? gl.REPEAT : gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap ? gl.REPEAT : gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);

        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        gl.viewport(0, 0, w, h);
        gl.clear(gl.COLOR_BUFFER_BIT);

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
        gl.useProgram(this.programs.curl);
        gl.uniform2f(gl.getUniformLocation(this.programs.curl, 'texelSize'), this.velocity.texelSizeX, this.velocity.texelSizeY);
        gl.uniform1i(gl.getUniformLocation(this.programs.curl, 'uVelocity'), this.velocity.read.attach(0));

        this.blit(this.curl);

        // Vorticity
        gl.useProgram(this.programs.vorticity);
        gl.uniform2f(gl.getUniformLocation(this.programs.vorticity, 'texelSize'), this.velocity.texelSizeX, this.velocity.texelSizeY);
        gl.uniform1i(gl.getUniformLocation(this.programs.vorticity, 'uVelocity'), this.velocity.read.attach(0));
        gl.uniform1i(gl.getUniformLocation(this.programs.vorticity, 'uCurl'), this.curl.attach(1));
        gl.uniform1f(gl.getUniformLocation(this.programs.vorticity, 'curl'), this.config.CURL);
        gl.uniform1f(gl.getUniformLocation(this.programs.vorticity, 'dt'), dt);

        this.blit(this.velocity.write);
        this.velocity.swap();

        // Divergence
        gl.useProgram(this.programs.divergence);
        gl.uniform2f(gl.getUniformLocation(this.programs.divergence, 'texelSize'), this.velocity.texelSizeX, this.velocity.texelSizeY);
        gl.uniform1i(gl.getUniformLocation(this.programs.divergence, 'uVelocity'), this.velocity.read.attach(0));

        this.blit(this.divergence);

        // Clear pressure
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.pressure.read.fbo);
        gl.clear(gl.COLOR_BUFFER_BIT);

        // Pressure
        gl.useProgram(this.programs.pressure);
        gl.uniform2f(gl.getUniformLocation(this.programs.pressure, 'texelSize'), this.velocity.texelSizeX, this.velocity.texelSizeY);
        gl.uniform1i(gl.getUniformLocation(this.programs.pressure, 'uDivergence'), this.divergence.attach(0));

        for (let i = 0; i < this.config.PRESSURE_ITERATIONS; i++) {
            gl.uniform1i(gl.getUniformLocation(this.programs.pressure, 'uPressure'), this.pressure.read.attach(1));
            this.blit(this.pressure.write);
            this.pressure.swap();
        }

        // Gradient subtract
        gl.useProgram(this.programs.gradientSubtract);
        gl.uniform2f(gl.getUniformLocation(this.programs.gradientSubtract, 'texelSize'), this.velocity.texelSizeX, this.velocity.texelSizeY);
        gl.uniform1i(gl.getUniformLocation(this.programs.gradientSubtract, 'uPressure'), this.pressure.read.attach(0));
        gl.uniform1i(gl.getUniformLocation(this.programs.gradientSubtract, 'uVelocity'), this.velocity.read.attach(1));

        this.blit(this.velocity.write);
        this.velocity.swap();

        // Advect velocity - FIX: Unbind textures properly to avoid feedback loop
        gl.useProgram(this.programs.advection);
        gl.uniform2f(gl.getUniformLocation(this.programs.advection, 'texelSize'), this.velocity.texelSizeX, this.velocity.texelSizeY);
        
        // First bind velocity texture
        const velocityTextureUnit = this.velocity.read.attach(0);
        gl.uniform1i(gl.getUniformLocation(this.programs.advection, 'uVelocity'), velocityTextureUnit);
        
        // Use the same texture for source in velocity advection (this is correct for self-advection)
        gl.uniform1i(gl.getUniformLocation(this.programs.advection, 'uSource'), velocityTextureUnit);
        
        gl.uniform1f(gl.getUniformLocation(this.programs.advection, 'dt'), dt);
        gl.uniform1f(gl.getUniformLocation(this.programs.advection, 'dissipation'), this.config.VELOCITY_DISSIPATION);

        this.blit(this.velocity.write);
        this.velocity.swap();

        // Advect color - FIX: Properly separate velocity and density texture units
        // Re-use the advection program but update texture uniforms
        gl.uniform2f(gl.getUniformLocation(this.programs.advection, 'texelSize'), this.density.texelSizeX, this.density.texelSizeY);
        
        // Use different texture units to avoid conflicts
        const velocityUnit = this.velocity.read.attach(0);
        const densityUnit = this.density.read.attach(1);
        
        gl.uniform1i(gl.getUniformLocation(this.programs.advection, 'uVelocity'), velocityUnit);
        gl.uniform1i(gl.getUniformLocation(this.programs.advection, 'uSource'), densityUnit);
        gl.uniform1f(gl.getUniformLocation(this.programs.advection, 'dissipation'), this.config.DENSITY_DISSIPATION);

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
        const gl = this.gl;
        
        if (target == null) {
            gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        } else {
            gl.viewport(0, 0, target.width, target.height);
            gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
        }
        
        // Use the reusable buffers instead of creating new ones
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(0);
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    }
}

// Only declare FluidSimulation if it doesn't already exist
if (typeof window !== 'undefined' && !window.FluidSimulation) {
    window.FluidSimulation = FluidSimulation;
}