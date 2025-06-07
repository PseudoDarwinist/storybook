/**
 * Simple WebGL Fluid Simulation
 * A minimal, highly compatible implementation focused on reliability
 */
(function() {
    // Only define if not already defined
    if (typeof window.FluidSimulation !== 'undefined') {
        return;
    }

    window.FluidSimulation = class FluidSimulation {
        constructor(canvas) {
            this.canvas = canvas;
            
            // Try to get WebGL context with maximum compatibility
            try {
                this.gl = canvas.getContext('webgl', { 
                    alpha: false,
                    depth: false,
                    stencil: false,
                    antialias: false,
                    preserveDrawingBuffer: false
                }) || canvas.getContext('experimental-webgl', {
                    alpha: false,
                    depth: false,
                    stencil: false,
                    antialias: false,
                    preserveDrawingBuffer: false
                });
            } catch (e) {
                console.error('WebGL initialization error:', e);
                return;
            }
            
            if (!this.gl) {
                console.error('WebGL not supported');
                return;
            }

            // Configuration parameters - simplified for maximum compatibility
            this.config = {
                DOWNSAMPLE: 1,                // Resolution downsampling (1 = full resolution)
                DENSITY_DISSIPATION: 0.98,     // How quickly colors fade
                VELOCITY_DISSIPATION: 0.99,    // How quickly motion slows down
                PRESSURE_ITERATIONS: 20,       // Pressure solver iterations
                SPLAT_RADIUS: 0.005,           // Size of color splats
                SPLAT_FORCE: 6000,             // Force of splats
                AUTO_SPLAT_INTERVAL: 3,        // Seconds between auto splats
                COLOR_PALETTE: [               // Predefined color palette
                    [0.8, 0.2, 0.8],           // Purple
                    [0.2, 0.8, 0.8],           // Cyan
                    [0.9, 0.4, 0.0],           // Orange
                    [0.0, 0.8, 0.4],           // Green
                    [0.8, 0.8, 0.0],           // Yellow
                    [0.0, 0.4, 0.8]            // Blue
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
            
            // Create shader programs
            this.programs = {};
            
            // Basic vertex shader used by all programs
            const baseVertexShader = `
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

            // Clear shader - fills texture with a solid color
            const clearShader = `
                precision mediump float;
                uniform vec4 color;
                void main () {
                    gl_FragColor = color;
                }
            `;
            
            // Display shader - renders the fluid to the screen
            const displayShader = `
                precision mediump float;
                varying vec2 vUv;
                uniform sampler2D uTexture;
                
                void main () {
                    gl_FragColor = texture2D(uTexture, vUv);
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
                    float splat = exp(-dot(p, p) / radius);
                    vec3 base = texture2D(uTarget, vUv).xyz;
                    gl_FragColor = vec4(base + splat * color, 1.0);
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
                    
                    float div = 0.5 * (R - L + T - B);
                    gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
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
            this.programs.clear = this.compileShader(baseVertexShader, clearShader);
            this.programs.display = this.compileShader(baseVertexShader, displayShader);
            this.programs.splat = this.compileShader(baseVertexShader, splatShader);
            this.programs.advection = this.compileShader(baseVertexShader, advectionShader);
            this.programs.divergence = this.compileShader(baseVertexShader, divergenceShader);
            this.programs.pressure = this.compileShader(baseVertexShader, pressureShader);
            this.programs.gradientSubtract = this.compileShader(baseVertexShader, gradientSubtractShader);
            
            // Setup uniform locations for all programs
            this.setUniformLocations();
            
            // Create framebuffers for simulation
            this.createFramebuffers();
            
            // Start render loop
            this.lastUpdateTime = Date.now();
            this.render();
            
            // Start automatic splat generation
            this.startAutoSplats();
        }

        setUniformLocations() {
            const gl = this.gl;
            
            this.clearProgram = this.programs.clear;
            this.clearProgram.uniforms = {
                color: gl.getUniformLocation(this.clearProgram, 'color')
            };
            
            this.displayProgram = this.programs.display;
            this.displayProgram.uniforms = {
                uTexture: gl.getUniformLocation(this.displayProgram, 'uTexture')
            };
            
            this.splatProgram = this.programs.splat;
            this.splatProgram.uniforms = {
                uTarget: gl.getUniformLocation(this.splatProgram, 'uTarget'),
                aspectRatio: gl.getUniformLocation(this.splatProgram, 'aspectRatio'),
                point: gl.getUniformLocation(this.splatProgram, 'point'),
                color: gl.getUniformLocation(this.splatProgram, 'color'),
                radius: gl.getUniformLocation(this.splatProgram, 'radius')
            };
            
            this.advectionProgram = this.programs.advection;
            this.advectionProgram.uniforms = {
                uVelocity: gl.getUniformLocation(this.advectionProgram, 'uVelocity'),
                uSource: gl.getUniformLocation(this.advectionProgram, 'uSource'),
                texelSize: gl.getUniformLocation(this.advectionProgram, 'texelSize'),
                dt: gl.getUniformLocation(this.advectionProgram, 'dt'),
                dissipation: gl.getUniformLocation(this.advectionProgram, 'dissipation')
            };
            
            this.divergenceProgram = this.programs.divergence;
            this.divergenceProgram.uniforms = {
                uVelocity: gl.getUniformLocation(this.divergenceProgram, 'uVelocity'),
                texelSize: gl.getUniformLocation(this.divergenceProgram, 'texelSize')
            };
            
            this.pressureProgram = this.programs.pressure;
            this.pressureProgram.uniforms = {
                uPressure: gl.getUniformLocation(this.pressureProgram, 'uPressure'),
                uDivergence: gl.getUniformLocation(this.pressureProgram, 'uDivergence'),
                texelSize: gl.getUniformLocation(this.pressureProgram, 'texelSize')
            };
            
            this.gradientSubtractProgram = this.programs.gradientSubtract;
            this.gradientSubtractProgram.uniforms = {
                uPressure: gl.getUniformLocation(this.gradientSubtractProgram, 'uPressure'),
                uVelocity: gl.getUniformLocation(this.gradientSubtractProgram, 'uVelocity'),
                texelSize: gl.getUniformLocation(this.gradientSubtractProgram, 'texelSize')
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

            // Set attribute location
            gl.bindAttribLocation(program, 0, 'aPosition');

            return program;
        }

        createFramebuffers() {
            const gl = this.gl;
            
            // Get simulation resolution based on canvas size and downsample factor
            const width = gl.drawingBufferWidth >> this.config.DOWNSAMPLE;
            const height = gl.drawingBufferHeight >> this.config.DOWNSAMPLE;
            
            // Texel size for simulation
            this.texelSize = {
                x: 1.0 / width,
                y: 1.0 / height
            };

            // Create vertex buffer for a quad covering the viewport
            const buffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
            
            // Create framebuffers for simulation
            try {
                // Create double framebuffer for velocity
                this.velocity = this.createDoubleFBO(width, height);
                
                // Create double framebuffer for density (color)
                this.density = this.createDoubleFBO(width, height);
                
                // Create framebuffer for divergence
                this.divergence = this.createFBO(width, height);
                
                // Create double framebuffer for pressure
                this.pressure = this.createDoubleFBO(width, height);
                
                // Clear all framebuffers to initial state
                this.clearProgram.uniforms = {
                    color: gl.getUniformLocation(this.clearProgram, 'color')
                };
                
                this.clear(this.velocity.read);
                this.clear(this.velocity.write);
                this.clear(this.density.read);
                this.clear(this.density.write);
                this.clear(this.pressure.read);
                this.clear(this.pressure.write);
                this.clear(this.divergence);
            } catch (error) {
                console.error('Error creating framebuffers:', error);
                throw new Error('WebGL framebuffer creation failed');
            }
        }

        createFBO(width, height) {
            const gl = this.gl;
            
            // Create texture
            const texture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            
            // Use RGBA/UNSIGNED_BYTE - the most compatible format
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            
            // Create framebuffer
            const fbo = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
            
            // Check framebuffer status
            const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
            if (status !== gl.FRAMEBUFFER_COMPLETE) {
                console.error('Framebuffer not complete. Status:', status);
                throw new Error('Framebuffer not complete');
            }
            
            // Unbind
            gl.bindTexture(gl.TEXTURE_2D, null);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            
            return {
                texture,
                fbo,
                width,
                height
            };
        }

        createDoubleFBO(width, height) {
            return {
                read: this.createFBO(width, height),
                write: this.createFBO(width, height),
                width,
                height,
                swap() {
                    const temp = this.read;
                    this.read = this.write;
                    this.write = temp;
                }
            };
        }

        clear(target) {
            const gl = this.gl;
            
            gl.useProgram(this.clearProgram);
            gl.uniform4f(this.clearProgram.uniforms.color, 0, 0, 0, 1);
            
            gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
            gl.viewport(0, 0, target.width, target.height);
            
            this.blit();
        }

        blit() {
            const gl = this.gl;
            
            gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
            gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
            gl.enableVertexAttribArray(0);
            gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
        }

        update() {
            // Calculate time delta
            const dt = this.calcDeltaTime();
            
            // Update simulation
            this.step(dt);
            
            // Apply inputs
            this.applyInputs();
        }

        calcDeltaTime() {
            const now = Date.now();
            let dt = (now - this.lastUpdateTime) / 1000;
            dt = Math.min(dt, 0.016); // Cap at ~60fps
            this.lastUpdateTime = now;
            return dt;
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
            
            // Advect velocity
            gl.viewport(0, 0, this.velocity.width, this.velocity.height);
            gl.useProgram(this.advectionProgram);
            gl.uniform2f(this.advectionProgram.uniforms.texelSize, this.texelSize.x, this.texelSize.y);
            gl.uniform1i(this.advectionProgram.uniforms.uVelocity, 0);
            gl.uniform1i(this.advectionProgram.uniforms.uSource, 0);
            gl.uniform1f(this.advectionProgram.uniforms.dt, dt);
            gl.uniform1f(this.advectionProgram.uniforms.dissipation, this.config.VELOCITY_DISSIPATION);
            
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.velocity.read.texture);
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.velocity.write.fbo);
            this.blit();
            this.velocity.swap();
            
            // Advect density (color)
            gl.viewport(0, 0, this.density.width, this.density.height);
            gl.uniform1i(this.advectionProgram.uniforms.uVelocity, 0);
            gl.uniform1i(this.advectionProgram.uniforms.uSource, 1);
            gl.uniform1f(this.advectionProgram.uniforms.dissipation, this.config.DENSITY_DISSIPATION);
            
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.velocity.read.texture);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, this.density.read.texture);
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.density.write.fbo);
            this.blit();
            this.density.swap();
            
            // Calculate divergence
            gl.viewport(0, 0, this.divergence.width, this.divergence.height);
            gl.useProgram(this.divergenceProgram);
            gl.uniform2f(this.divergenceProgram.uniforms.texelSize, this.texelSize.x, this.texelSize.y);
            gl.uniform1i(this.divergenceProgram.uniforms.uVelocity, 0);
            
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.velocity.read.texture);
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.divergence.fbo);
            this.blit();
            
            // Clear pressure
            this.clear(this.pressure.read);
            
            // Solve pressure
            gl.viewport(0, 0, this.pressure.width, this.pressure.height);
            gl.useProgram(this.pressureProgram);
            gl.uniform2f(this.pressureProgram.uniforms.texelSize, this.texelSize.x, this.texelSize.y);
            gl.uniform1i(this.pressureProgram.uniforms.uDivergence, 0);
            
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.divergence.texture);
            
            // Pressure iterations
            for (let i = 0; i < this.config.PRESSURE_ITERATIONS; i++) {
                gl.uniform1i(this.pressureProgram.uniforms.uPressure, 1);
                gl.activeTexture(gl.TEXTURE1);
                gl.bindTexture(gl.TEXTURE_2D, this.pressure.read.texture);
                gl.bindFramebuffer(gl.FRAMEBUFFER, this.pressure.write.fbo);
                this.blit();
                this.pressure.swap();
            }
            
            // Apply pressure gradient
            gl.viewport(0, 0, this.velocity.width, this.velocity.height);
            gl.useProgram(this.gradientSubtractProgram);
            gl.uniform2f(this.gradientSubtractProgram.uniforms.texelSize, this.texelSize.x, this.texelSize.y);
            gl.uniform1i(this.gradientSubtractProgram.uniforms.uPressure, 0);
            gl.uniform1i(this.gradientSubtractProgram.uniforms.uVelocity, 1);
            
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.pressure.read.texture);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, this.velocity.read.texture);
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.velocity.write.fbo);
            this.blit();
            this.velocity.swap();
        }

        render() {
            if (!this.gl) return;
            
            // Update simulation
            this.update();
            
            // Draw to screen
            const gl = this.gl;
            gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.useProgram(this.displayProgram);
            gl.uniform1i(this.displayProgram.uniforms.uTexture, 0);
            
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.density.read.texture);
            this.blit();
            
            // Continue animation loop
            requestAnimationFrame(() => this.render());
        }

        multipleSplats(amount) {
            for (let i = 0; i < amount; i++) {
                // Create random positions with bias towards center
                const x = Math.random() * 0.6 + 0.2;
                const y = Math.random() * 0.6 + 0.2;
                
                // Get color from palette with variation
                const color = this.getColorFromPalette();
                
                // Apply splat
                this.splat(x, y, 0, 0, color);
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
                dx,
                dy,
                pointer.color
            );
        }

        splat(x, y, dx, dy, color) {
            const gl = this.gl;
            
            // Apply velocity
            gl.viewport(0, 0, this.velocity.width, this.velocity.height);
            gl.useProgram(this.splatProgram);
            gl.uniform1i(this.splatProgram.uniforms.uTarget, 0);
            gl.uniform1f(this.splatProgram.uniforms.aspectRatio, this.canvas.width / this.canvas.height);
            gl.uniform2f(this.splatProgram.uniforms.point, x, y);
            gl.uniform3f(this.splatProgram.uniforms.color, dx, -dy, 0);
            gl.uniform1f(this.splatProgram.uniforms.radius, this.config.SPLAT_RADIUS);
            
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.velocity.read.texture);
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.velocity.write.fbo);
            this.blit();
            this.velocity.swap();
            
            // Apply color
            gl.viewport(0, 0, this.density.width, this.density.height);
            gl.uniform1i(this.splatProgram.uniforms.uTarget, 0);
            gl.uniform3f(this.splatProgram.uniforms.color, color[0], color[1], color[2]);
            
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.density.read.texture);
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.density.write.fbo);
            this.blit();
            this.density.swap();
        }

        startAutoSplats() {
            // Create initial splats
            this.multipleSplats(5);
            
            // Set up interval for continuous motion
            setInterval(() => {
                this.multipleSplats(1);
            }, 2000);
        }

        getColorFromPalette() {
            // Get a color from the predefined palette
            const color = this.config.COLOR_PALETTE[this.colorIndex];
            
            // Cycle through colors
            this.colorIndex = (this.colorIndex + 1) % this.config.COLOR_PALETTE.length;
            
            return color;
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
            pointer.color = this.getColorFromPalette();
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
})();
