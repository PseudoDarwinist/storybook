// Check if FluidSimulation is already defined to avoid redeclaration errors
if (typeof window.FluidSimulation === 'undefined') {
    // Main FluidSimulation class
    window.FluidSimulation = class FluidSimulation {
        constructor(canvas) {
            this.canvas = canvas;
            
            // Try WebGL2 first, then fall back to WebGL1
            try {
                this.gl = canvas.getContext('webgl2') || 
                          canvas.getContext('webgl') || 
                          canvas.getContext('experimental-webgl');
                
                // Store WebGL version for later use
                this.isWebGL2 = !!canvas.getContext('webgl2');
            } catch (e) {
                console.error('WebGL initialization error:', e);
                return;
            }
            
            if (!this.gl) {
                console.error('WebGL not supported');
                return;
            }

            // Configuration parameters
            this.config = {
                SIM_RESOLUTION: 128,           // Resolution for simulation
                DYE_RESOLUTION: 512,           // Resolution for dye (colors)
                DENSITY_DISSIPATION: 0.97,     // How quickly colors fade
                VELOCITY_DISSIPATION: 0.98,    // How quickly motion slows down
                PRESSURE_ITERATIONS: 20,       // Pressure solver iterations
                CURL: 30,                      // Curl intensity (swirling)
                SPLAT_RADIUS: 0.25,            // Size of color splats
                SPLAT_FORCE: 6000,             // Force of splats
                COLORFUL: true,                // Use colorful splats
                COLOR_UPDATE_SPEED: 10,        // Speed of color changes
                PAUSED: false,                 // Pause simulation
                AUTO_SPLAT_INTERVAL: 3,        // Seconds between auto splats
                COLOR_PALETTE: [               // Predefined color palette
                    { r: 0.8, g: 0.2, b: 0.8 }, // Purple
                    { r: 0.2, g: 0.8, b: 0.8 }, // Cyan
                    { r: 0.9, g: 0.4, b: 0.0 }, // Orange
                    { r: 0.0, g: 0.8, b: 0.4 }, // Green
                    { r: 0.8, g: 0.8, b: 0.0 }, // Yellow
                    { r: 0.0, g: 0.4, b: 0.8 }  // Blue
                ]
            };

            this.pointers = [];
            this.splatStack = [];
            this.colorIndex = 0;
            this.lastSplatTime = Date.now();
            
            this.init();
        }

        init() {
            const gl = this.gl;
            
            // Extension support - store actual extension objects
            const extensions = {
                textureHalfFloat: gl.getExtension('OES_texture_half_float'),
                textureFloat: gl.getExtension('OES_texture_float'),
                textureHalfFloatLinear: gl.getExtension('OES_texture_half_float_linear'),
                textureFloatLinear: gl.getExtension('OES_texture_float_linear')
            };
            
            // Set up format constants based on WebGL version and extensions
            const ext = {};
            
            // Use conservative formats by default
            ext.formatRGBA = gl.RGBA;
            ext.internalFormatRGBA = gl.RGBA;
            ext.texType = gl.UNSIGNED_BYTE;
            
            // Try to use better formats if supported
            if (this.isWebGL2) {
                // WebGL2 has better format support
                try {
                    ext.texType = gl.HALF_FLOAT;
                } catch (e) {
                    console.warn('HALF_FLOAT not supported, using UNSIGNED_BYTE');
                }
            } else {
                // WebGL1 needs extensions for float textures
                if (extensions.textureHalfFloat) {
                    try {
                        ext.texType = extensions.textureHalfFloat.HALF_FLOAT_OES;
                    } catch (e) {
                        console.warn('HALF_FLOAT_OES not supported, using UNSIGNED_BYTE');
                    }
                }
            }

            this.ext = ext;

            // Create shaders and programs
            this.programs = this.createPrograms();
            
            // Create framebuffers
            try {
                this.createFramebuffers();
            } catch (e) {
                console.error('Error creating framebuffers:', e);
                throw new Error('WebGL framebuffer creation failed');
            }
            
            // Start render loop
            this.lastUpdateTime = Date.now();
            this.colorUpdateTimer = 0.0;
            this.render();
            
            // Start automatic splat generation
            this.startAutoSplats();
        }

        createPrograms() {
            const gl = this.gl;
            
            // Vertex shader (same for all programs)
            // Using mediump precision for better compatibility
            const vertexShader = `
                precision mediump float;
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

            // Display shader - renders the fluid to the screen
            const displayShader = `
                precision mediump float;
                varying vec2 vUv;
                uniform sampler2D uTexture;
                
                void main () {
                    vec3 color = texture2D(uTexture, vUv).rgb;
                    // Simple color enhancement
                    color = clamp(color * 1.2, 0.0, 1.0);
                    gl_FragColor = vec4(color, 1.0);
                }
            `;

            // Splat shader - adds color to the fluid
            const splatShader = `
                precision mediump float;
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

            // Advection shader - moves the fluid
            const advectionShader = `
                precision mediump float;
                varying vec2 vUv;
                uniform sampler2D uVelocity;
                uniform sampler2D uSource;
                uniform vec2 texelSize;
                uniform float dt;
                uniform float dissipation;
                
                void main () {
                    vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
                    gl_FragColor = dissipation * texture2D(uSource, coord);
                }
            `;

            // Divergence shader - calculates fluid divergence
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

            // Curl shader - calculates fluid curl (rotation)
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

            // Vorticity shader - applies rotational forces
            const vorticityShader = `
                precision mediump float;
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
                    
                    vec2 force = vec2(abs(T) - abs(B), abs(R) - abs(L));
                    force /= length(force) + 0.0001;
                    force *= curl * C;
                    force.y *= -1.0;
                    
                    vec2 vel = texture2D(uVelocity, vUv).xy;
                    gl_FragColor = vec4(vel + force * dt, 0.0, 1.0);
                }
            `;

            // Pressure shader - calculates fluid pressure
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

            // Gradient subtract shader - applies pressure gradient
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

            // Compile all shaders into programs
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
            
            // Compile vertex shader
            const vertexShader = gl.createShader(gl.VERTEX_SHADER);
            gl.shaderSource(vertexShader, vertexSource);
            gl.compileShader(vertexShader);
            
            // Check for vertex shader compilation errors
            if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
                console.error('Error compiling vertex shader:', gl.getShaderInfoLog(vertexShader));
                return null;
            }

            // Compile fragment shader
            const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
            gl.shaderSource(fragmentShader, fragmentSource);
            gl.compileShader(fragmentShader);
            
            // Check for fragment shader compilation errors
            if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
                console.error('Error compiling fragment shader:', gl.getShaderInfoLog(fragmentShader));
                return null;
            }

            // Link shaders into a program
            const program = gl.createProgram();
            gl.attachShader(program, vertexShader);
            gl.attachShader(program, fragmentShader);
            gl.linkProgram(program);
            
            // Check for program linking errors
            if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
                console.error('Error linking program:', gl.getProgramInfoLog(program));
                return null;
            }

            return program;
        }

        createFramebuffers() {
            const gl = this.gl;
            const ext = this.ext;

            // Create textures
            const simRes = this.getResolution(this.config.SIM_RESOLUTION);
            const dyeRes = this.getResolution(this.config.DYE_RESOLUTION);

            try {
                // Create double framebuffer for density (color)
                this.density = this.createDoubleFBO(
                    dyeRes.width, 
                    dyeRes.height, 
                    ext.internalFormatRGBA, 
                    ext.formatRGBA, 
                    ext.texType, 
                    gl.LINEAR
                );
                
                // Create double framebuffer for velocity
                this.velocity = this.createDoubleFBO(
                    simRes.width, 
                    simRes.height, 
                    ext.internalFormatRGBA, 
                    ext.formatRGBA, 
                    ext.texType, 
                    gl.LINEAR
                );
                
                // Create framebuffer for divergence
                this.divergence = this.createFBO(
                    simRes.width, 
                    simRes.height, 
                    ext.internalFormatRGBA, 
                    ext.formatRGBA, 
                    ext.texType, 
                    gl.NEAREST
                );
                
                // Create framebuffer for curl
                this.curl = this.createFBO(
                    simRes.width, 
                    simRes.height, 
                    ext.internalFormatRGBA, 
                    ext.formatRGBA, 
                    ext.texType, 
                    gl.NEAREST
                );
                
                // Create double framebuffer for pressure
                this.pressure = this.createDoubleFBO(
                    simRes.width, 
                    simRes.height, 
                    ext.internalFormatRGBA, 
                    ext.formatRGBA, 
                    ext.texType, 
                    gl.NEAREST
                );
            } catch (error) {
                console.error('Error creating framebuffers:', error);
                throw new Error('WebGL framebuffer creation failed');
            }

            // Create vertex buffer for rendering
            this.blit = (() => {
                // Create a buffer for a full-screen quad
                const buffer = gl.createBuffer();
                gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
                gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
                
                // Create an element buffer for indexed rendering
                const indexBuffer = gl.createBuffer();
                gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
                gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
                
                return (target) => {
                    // Bind the framebuffer and set viewport
                    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
                    if (target) {
                        gl.viewport(0, 0, target.width, target.height);
                    } else {
                        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
                    }
                    
                    // Bind the buffers and draw
                    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
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

        createFBO(w, h, internalFormat, format, type, filter) {
            const gl = this.gl;
            
            // Ensure width and height are valid
            if (w <= 0 || h <= 0) {
                console.error('Invalid framebuffer dimensions:', w, h);
                throw new Error('Invalid framebuffer dimensions');
            }
            
            // Create and configure texture
            gl.activeTexture(gl.TEXTURE0);
            const texture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            
            // Create texture with proper format
            try {
                gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);
            } catch (error) {
                console.error('Error creating texture:', error);
                // Fallback to RGBA/UNSIGNED_BYTE if texture creation fails
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            }

            // Create and configure framebuffer
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

        createDoubleFBO(w, h, internalFormat, format, type, filter) {
            // Create two framebuffers to ping-pong between
            let fbo1 = this.createFBO(w, h, internalFormat, format, type, filter);
            let fbo2 = this.createFBO(w, h, internalFormat, format, type, filter);

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
            // Calculate time delta
            const dt = this.calcDeltaTime();
            if (this.config.PAUSED) return;

            // Update colors and apply inputs
            this.updateColors(dt);
            this.applyInputs();
            
            // Perform simulation step
            if (!this.config.PAUSED) {
                this.step(dt);
            }
        }

        calcDeltaTime() {
            const now = Date.now();
            let dt = (now - this.lastUpdateTime) / 1000;
            dt = Math.min(dt, 0.016666); // Cap at ~60fps
            this.lastUpdateTime = now;
            return dt;
        }

        updateColors(dt) {
            if (!this.config.COLORFUL) return;

            // Update color timer
            this.colorUpdateTimer += dt * this.config.COLOR_UPDATE_SPEED;
            if (this.colorUpdateTimer >= 1) {
                this.colorUpdateTimer = this.wrap(this.colorUpdateTimer, 0, 1);
                
                // Update colors for all pointers
                this.pointers.forEach(p => {
                    p.color = this.generateColor();
                });
            }
        }

        applyInputs() {
            // Apply automatic splats
            const now = Date.now();
            if (now - this.lastSplatTime > this.config.AUTO_SPLAT_INTERVAL * 1000) {
                this.lastSplatTime = now;
                this.multipleSplats(Math.floor(Math.random() * 2) + 2); // 2-3 random splats
            }

            // Apply manual splats from splatStack
            if (this.splatStack.length > 0) {
                this.multipleSplats(this.splatStack.pop());
            }

            // Apply pointer movement
            this.pointers.forEach(p => {
                if (p.moved) {
                    p.moved = false;
                    this.splatPointer(p);
                }
            });
        }

        step(dt) {
            const gl = this.gl;

            // Disable blending for simulation steps
            gl.disable(gl.BLEND);

            // Calculate curl
            gl.useProgram(this.programs.curl);
            gl.uniform2f(gl.getUniformLocation(this.programs.curl, 'texelSize'), 
                this.velocity.texelSizeX, this.velocity.texelSizeY);
            gl.uniform1i(gl.getUniformLocation(this.programs.curl, 'uVelocity'), 
                this.velocity.read.attach(0));
            this.blit(this.curl);

            // Apply vorticity (swirl)
            gl.useProgram(this.programs.vorticity);
            gl.uniform2f(gl.getUniformLocation(this.programs.vorticity, 'texelSize'), 
                this.velocity.texelSizeX, this.velocity.texelSizeY);
            gl.uniform1i(gl.getUniformLocation(this.programs.vorticity, 'uVelocity'), 
                this.velocity.read.attach(0));
            gl.uniform1i(gl.getUniformLocation(this.programs.vorticity, 'uCurl'), 
                this.curl.attach(1));
            gl.uniform1f(gl.getUniformLocation(this.programs.vorticity, 'curl'), 
                this.config.CURL);
            gl.uniform1f(gl.getUniformLocation(this.programs.vorticity, 'dt'), dt);
            this.blit(this.velocity.write);
            this.velocity.swap();

            // Calculate divergence
            gl.useProgram(this.programs.divergence);
            gl.uniform2f(gl.getUniformLocation(this.programs.divergence, 'texelSize'), 
                this.velocity.texelSizeX, this.velocity.texelSizeY);
            gl.uniform1i(gl.getUniformLocation(this.programs.divergence, 'uVelocity'), 
                this.velocity.read.attach(0));
            this.blit(this.divergence);

            // Clear pressure
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.pressure.read.fbo);
            gl.clear(gl.COLOR_BUFFER_BIT);

            // Solve pressure
            gl.useProgram(this.programs.pressure);
            gl.uniform2f(gl.getUniformLocation(this.programs.pressure, 'texelSize'), 
                this.velocity.texelSizeX, this.velocity.texelSizeY);
            gl.uniform1i(gl.getUniformLocation(this.programs.pressure, 'uDivergence'), 
                this.divergence.attach(0));

            // Pressure iterations
            for (let i = 0; i < this.config.PRESSURE_ITERATIONS; i++) {
                gl.uniform1i(gl.getUniformLocation(this.programs.pressure, 'uPressure'), 
                    this.pressure.read.attach(1));
                this.blit(this.pressure.write);
                this.pressure.swap();
            }

            // Apply pressure gradient
            gl.useProgram(this.programs.gradientSubtract);
            gl.uniform2f(gl.getUniformLocation(this.programs.gradientSubtract, 'texelSize'), 
                this.velocity.texelSizeX, this.velocity.texelSizeY);
            gl.uniform1i(gl.getUniformLocation(this.programs.gradientSubtract, 'uPressure'), 
                this.pressure.read.attach(0));
            gl.uniform1i(gl.getUniformLocation(this.programs.gradientSubtract, 'uVelocity'), 
                this.velocity.read.attach(1));
            this.blit(this.velocity.write);
            this.velocity.swap();

            // Advect velocity
            gl.useProgram(this.programs.advection);
            gl.uniform2f(gl.getUniformLocation(this.programs.advection, 'texelSize'), 
                this.velocity.texelSizeX, this.velocity.texelSizeY);
            gl.uniform1i(gl.getUniformLocation(this.programs.advection, 'uVelocity'), 
                this.velocity.read.attach(0));
            gl.uniform1i(gl.getUniformLocation(this.programs.advection, 'uSource'), 
                this.velocity.read.attach(1));
            gl.uniform1f(gl.getUniformLocation(this.programs.advection, 'dt'), dt);
            gl.uniform1f(gl.getUniformLocation(this.programs.advection, 'dissipation'), 
                this.config.VELOCITY_DISSIPATION);
            this.blit(this.velocity.write);
            this.velocity.swap();

            // Advect density (color)
            gl.uniform1i(gl.getUniformLocation(this.programs.advection, 'uSource'), 
                this.density.read.attach(1));
            gl.uniform1f(gl.getUniformLocation(this.programs.advection, 'dissipation'), 
                this.config.DENSITY_DISSIPATION);
            this.blit(this.density.write);
            this.density.swap();
        }

        render() {
            if (!this.gl) return;
            
            // Update simulation and draw to screen
            this.update();
            this.drawDisplay();
            
            // Continue animation loop
            requestAnimationFrame(() => this.render());
        }

        drawDisplay() {
            const gl = this.gl;
            
            // Set up display program
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
            
            // Enable blending for display
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            
            // Draw the final result
            gl.useProgram(this.programs.display);
            gl.uniform1i(gl.getUniformLocation(this.programs.display, 'uTexture'), 
                this.density.read.attach(0));
            this.blit();
        }

        multipleSplats(amount) {
            for (let i = 0; i < amount; i++) {
                // Create random positions with bias towards center
                const x = Math.random() * 0.6 + 0.2;
                const y = Math.random() * 0.6 + 0.2;
                
                // Get color from palette with variation
                const color = this.getColorFromPalette();
                const r = color.r * (0.8 + Math.random() * 0.4);
                const g = color.g * (0.8 + Math.random() * 0.4);
                const b = color.b * (0.8 + Math.random() * 0.4);
                
                // Vary the splat radius
                const radius = this.config.SPLAT_RADIUS * (0.5 + Math.random() * 1.0);
                
                // Apply splat
                this.splat(x, y, r, g, b, radius);
            }
        }

        splatPointer(pointer) {
            // Calculate velocity from pointer movement
            const dx = pointer.deltaX * this.config.SPLAT_FORCE;
            const dy = pointer.deltaY * this.config.SPLAT_FORCE;
            
            // Apply splat
            this.splat(
                pointer.texcoordX,
                pointer.texcoordY,
                pointer.color.r,
                pointer.color.g,
                pointer.color.b,
                this.config.SPLAT_RADIUS
            );
        }

        splat(x, y, r, g, b, radius) {
            const gl = this.gl;
            
            // Apply velocity
            gl.viewport(0, 0, this.velocity.width, this.velocity.height);
            gl.useProgram(this.programs.splat);
            gl.uniform1i(gl.getUniformLocation(this.programs.splat, 'uTarget'), 
                this.velocity.read.attach(0));
            gl.uniform1f(gl.getUniformLocation(this.programs.splat, 'aspectRatio'), 
                this.canvas.width / this.canvas.height);
            gl.uniform2f(gl.getUniformLocation(this.programs.splat, 'point'), x, y);
            gl.uniform3f(gl.getUniformLocation(this.programs.splat, 'color'), 
                r * 0.3 * (Math.random() - 0.5), 
                g * 0.3 * (Math.random() - 0.5), 
                0
            );
            gl.uniform1f(gl.getUniformLocation(this.programs.splat, 'radius'), radius / 100);
            this.blit(this.velocity.write);
            this.velocity.swap();
            
            // Apply color
            gl.viewport(0, 0, this.density.width, this.density.height);
            gl.uniform1i(gl.getUniformLocation(this.programs.splat, 'uTarget'), 
                this.density.read.attach(0));
            gl.uniform3f(gl.getUniformLocation(this.programs.splat, 'color'), r, g, b);
            this.blit(this.density.write);
            this.density.swap();
        }

        startAutoSplats() {
            // Create initial splats
            this.multipleSplats(5);
        }

        generateColor() {
            // Generate vibrant colors
            const h = Math.random();
            const s = 0.7 + Math.random() * 0.3; // High saturation
            const v = 0.8 + Math.random() * 0.2; // High value
            
            const color = this.hsvToRgb(h, s, v);
            return {
                r: color.r,
                g: color.g,
                b: color.b
            };
        }

        getColorFromPalette() {
            // Get a color from the predefined palette
            const color = this.config.COLOR_PALETTE[this.colorIndex];
            
            // Cycle through colors
            this.colorIndex = (this.colorIndex + 1) % this.config.COLOR_PALETTE.length;
            
            return color;
        }

        hsvToRgb(h, s, v) {
            let r, g, b;
            const i = Math.floor(h * 6);
            const f = h * 6 - i;
            const p = v * (1 - s);
            const q = v * (1 - f * s);
            const t = v * (1 - (1 - f) * s);
            
            switch (i % 6) {
                case 0: r = v; g = t; b = p; break;
                case 1: r = q; g = v; b = p; break;
                case 2: r = p; g = v; b = t; break;
                case 3: r = p; g = q; b = v; break;
                case 4: r = t; g = p; b = v; break;
                case 5: r = v; g = p; b = q; break;
            }
            
            return { r, g, b };
        }

        wrap(value, min, max) {
            return value < min ? max - (min - value) % (max - min) : min + (value - min) % (max - min);
        }

        // Methods to handle pointer input
        updatePointerDownData(pointer, id, x, y) {
            pointer.id = id;
            pointer.down = true;
            pointer.moved = false;
            pointer.texcoordX = x / this.canvas.width;
            pointer.texcoordY = 1.0 - y / this.canvas.height;
            pointer.prevTexcoordX = pointer.texcoordX;
            pointer.prevTexcoordY = pointer.texcoordY;
            pointer.deltaX = 0;
            pointer.deltaY = 0;
            pointer.color = this.generateColor();
        }

        updatePointerMoveData(pointer, x, y) {
            pointer.prevTexcoordX = pointer.texcoordX;
            pointer.prevTexcoordY = pointer.texcoordY;
            pointer.texcoordX = x / this.canvas.width;
            pointer.texcoordY = 1.0 - y / this.canvas.height;
            pointer.deltaX = pointer.texcoordX - pointer.prevTexcoordX;
            pointer.deltaY = pointer.texcoordY - pointer.prevTexcoordY;
            pointer.moved = Math.abs(pointer.deltaX) > 0 || Math.abs(pointer.deltaY) > 0;
        }

        updatePointerUpData(pointer) {
            pointer.down = false;
        }

        // Method to resize the simulation
        resize() {
            const gl = this.gl;
            
            // Resize canvas to full screen
            gl.canvas.width = window.innerWidth;
            gl.canvas.height = window.innerHeight;
            
            // Recreate framebuffers with new size
            try {
                this.createFramebuffers();
            } catch (e) {
                console.error('Error recreating framebuffers on resize:', e);
            }
        }
    };
}
