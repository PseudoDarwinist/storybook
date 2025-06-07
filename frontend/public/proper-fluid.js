/**
 * WebGL Fluid Simulation
 * 
 * Inspired by https://github.com/PavelDoGreat/WebGL-Fluid-Simulation
 * Adapted to create ink-like swirling fluid effects
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
                    alpha: true,
                    depth: false,
                    stencil: false,
                    antialias: false,
                    preserveDrawingBuffer: false
                }) || canvas.getContext('experimental-webgl', {
                    alpha: true,
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

            // Configuration parameters - tuned for ink-like effect
            this.config = {
                DOWNSAMPLE: 0,                // Resolution downsampling (0 = full resolution)
                DENSITY_DISSIPATION: 0.97,    // How quickly colors fade (lower = longer trails)
                VELOCITY_DISSIPATION: 0.98,   // How quickly motion slows down
                PRESSURE_ITERATIONS: 25,      // Pressure solver iterations (higher = more accurate)
                CURL: 50,                     // Curl intensity (higher = more swirling)
                SPLAT_RADIUS: 0.25,           // Size of color splats (much larger than before)
                SPLAT_FORCE: 6000,            // Force of splats
                SHADING: true,                // Enable shading
                COLORFUL: true,               // Enable colorful mode
                PAUSED: false,                // Pause simulation
                BACK_COLOR: { r: 0.01, g: 0.10, b: 0.08 }, // Dark green/teal background
                TRANSPARENT: false,           // Transparent background
                BLOOM: true,                  // Enable bloom effect
                BLOOM_ITERATIONS: 8,          // Bloom effect iterations
                BLOOM_RESOLUTION: 256,        // Bloom effect resolution
                BLOOM_INTENSITY: 0.8,         // Bloom effect intensity
                BLOOM_THRESHOLD: 0.6,         // Bloom effect threshold
                BLOOM_SOFT_KNEE: 0.7,         // Bloom effect soft knee
                SUNRAYS: true,                // Enable sunrays effect
                SUNRAYS_RESOLUTION: 196,      // Sunrays effect resolution
                SUNRAYS_WEIGHT: 1.0,          // Sunrays effect weight
                AUTO_SPLAT_INTERVAL: 4,       // Seconds between auto splats
                MOTION_SPEED: 1.0,            // Overall motion speed multiplier
                COLOR_PALETTE: [              // Vibrant color palette matching screenshots
                    { r: 0.0, g: 0.9, b: 0.3 },  // Bright green
                    { r: 0.1, g: 0.6, b: 0.9 },  // Blue
                    { r: 0.8, g: 0.2, b: 0.8 },  // Purple
                    { r: 0.9, g: 0.7, b: 0.1 },  // Yellow
                    { r: 0.9, g: 0.4, b: 0.1 }   // Orange
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
                textureHalfFloatLinear: gl.getExtension('OES_texture_half_float_linear'),
                textureFloat: gl.getExtension('OES_texture_float'),
                textureFloatLinear: gl.getExtension('OES_texture_float_linear')
            };
            
            // Set up format constants based on WebGL version and extensions
            const ext = {};
            
            // Use compatible formats
            ext.formatRGBA = gl.RGBA;
            ext.internalFormatRGBA = gl.RGBA;
            ext.texType = gl.UNSIGNED_BYTE;
            
            // Try to use better formats if supported
            if (extensions.textureHalfFloat) {
                try {
                    ext.texType = extensions.textureHalfFloat.HALF_FLOAT_OES;
                } catch (e) {
                    console.warn('HALF_FLOAT_OES not supported, using UNSIGNED_BYTE');
                }
            }

            this.ext = ext;

            // Create shader programs
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
            const baseVertexShader = `
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

            // Clear shader - fills texture with a solid color
            const clearShader = `
                precision highp float;
                uniform vec4 color;
                void main () {
                    gl_FragColor = color;
                }
            `;
            
            // Display shader - renders the fluid to the screen with enhanced visuals
            const displayShader = `
                precision highp float;
                varying vec2 vUv;
                uniform sampler2D uTexture;
                uniform float uAlpha;
                
                void main () {
                    vec3 color = texture2D(uTexture, vUv).rgb;
                    
                    // Enhance colors for more vibrant look
                    color = pow(color, vec3(0.85)); // Gamma adjustment for more vibrant colors
                    
                    // Add slight vignette effect
                    float d = length(vUv - 0.5) * 1.5;
                    color *= 1.0 - d * 0.15;
                    
                    gl_FragColor = vec4(color, uAlpha);
                }
            `;

            // Enhanced splat shader - creates larger, more organic splats
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
                    
                    // Create more organic splat shape
                    float dist = length(p);
                    float splat = exp(-dist * dist / radius);
                    
                    // Add some noise to make it more organic
                    float noise = fract(sin(dot(vUv, vec2(12.9898, 78.233))) * 43758.5453);
                    splat *= (0.85 + 0.15 * noise);
                    
                    vec3 base = texture2D(uTarget, vUv).xyz;
                    gl_FragColor = vec4(base + splat * color, 1.0);
                }
            `;

            // Advection shader - moves the fluid with improved motion
            const advectionShader = `
                precision highp float;
                varying vec2 vUv;
                uniform sampler2D uVelocity;
                uniform sampler2D uSource;
                uniform vec2 texelSize;
                uniform float dt;
                uniform float dissipation;
                
                void main () {
                    vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
                    
                    // Improved bilinear interpolation for smoother motion
                    vec2 p = coord / texelSize;
                    vec2 f = fract(p);
                    p = floor(p) * texelSize;
                    
                    vec4 tl = texture2D(uSource, p);
                    vec4 tr = texture2D(uSource, p + vec2(texelSize.x, 0.0));
                    vec4 bl = texture2D(uSource, p + vec2(0.0, texelSize.y));
                    vec4 br = texture2D(uSource, p + vec2(texelSize.x, texelSize.y));
                    
                    vec4 result = mix(mix(tl, tr, f.x), mix(bl, br, f.x), f.y);
                    
                    gl_FragColor = dissipation * result;
                }
            `;

            // Divergence shader - calculates fluid divergence
            const divergenceShader = `
                precision highp float;
                varying vec2 vUv;
                varying vec2 vL;
                varying vec2 vR;
                varying vec2 vT;
                varying vec2 vB;
                uniform sampler2D uVelocity;
                uniform float halfrdx;
                
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
                    
                    float div = halfrdx * (R - L + T - B);
                    gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
                }
            `;

            // Curl shader - calculates fluid curl (rotation)
            const curlShader = `
                precision highp float;
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

            // Vorticity shader - applies rotational forces for swirling
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
                precision highp float;
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
                precision highp float;
                varying vec2 vUv;
                varying vec2 vL;
                varying vec2 vR;
                varying vec2 vT;
                varying vec2 vB;
                uniform sampler2D uPressure;
                uniform sampler2D uVelocity;
                uniform float halfrdx;
                
                void main () {
                    float L = texture2D(uPressure, vL).x;
                    float R = texture2D(uPressure, vR).x;
                    float T = texture2D(uPressure, vT).x;
                    float B = texture2D(uPressure, vB).x;
                    vec2 velocity = texture2D(uVelocity, vUv).xy;
                    velocity.xy -= halfrdx * vec2(R - L, T - B);
                    gl_FragColor = vec4(velocity, 0.0, 1.0);
                }
            `;

            // Bloom prefilter shader - for glow effect
            const bloomPrefilterShader = `
                precision highp float;
                varying vec2 vUv;
                uniform sampler2D uTexture;
                uniform vec3 curve;
                uniform float threshold;
                
                void main() {
                    vec3 c = texture2D(uTexture, vUv).rgb;
                    float brightness = max(c.r, max(c.g, c.b));
                    float soft = brightness - curve.y;
                    soft = clamp(soft, 0.0, curve.z);
                    soft = curve.x * soft * soft;
                    float contribution = max(soft, brightness - threshold);
                    contribution /= max(brightness, 0.00001);
                    gl_FragColor = vec4(c * contribution, 1.0);
                }
            `;

            // Bloom blur shader - for glow effect
            const bloomBlurShader = `
                precision highp float;
                varying vec2 vUv;
                uniform sampler2D uTexture;
                uniform vec2 texelSize;
                uniform vec2 direction;
                
                // Gaussian blur with 9 samples
                void main() {
                    vec3 color = vec3(0.0);
                    vec2 off1 = vec2(1.3846153846) * direction;
                    vec2 off2 = vec2(3.2307692308) * direction;
                    vec2 off3 = vec2(5.0769230769) * direction;
                    
                    color += texture2D(uTexture, vUv).rgb * 0.2270270270;
                    color += texture2D(uTexture, vUv + (off1 * texelSize)).rgb * 0.3162162162;
                    color += texture2D(uTexture, vUv - (off1 * texelSize)).rgb * 0.3162162162;
                    color += texture2D(uTexture, vUv + (off2 * texelSize)).rgb * 0.0702702703;
                    color += texture2D(uTexture, vUv - (off2 * texelSize)).rgb * 0.0702702703;
                    color += texture2D(uTexture, vUv + (off3 * texelSize)).rgb * 0.0000000000;
                    color += texture2D(uTexture, vUv - (off3 * texelSize)).rgb * 0.0000000000;
                    
                    gl_FragColor = vec4(color, 1.0);
                }
            `;

            // Bloom final shader - combines bloom with original image
            const bloomFinalShader = `
                precision highp float;
                varying vec2 vUv;
                uniform sampler2D uTexture;
                uniform sampler2D uBloom;
                uniform float intensity;
                
                void main() {
                    vec3 color = texture2D(uTexture, vUv).rgb;
                    vec3 bloom = texture2D(uBloom, vUv).rgb;
                    
                    // Blend bloom with original color
                    color += bloom * intensity;
                    
                    gl_FragColor = vec4(color, 1.0);
                }
            `;

            // Sunrays shader - for light ray effect
            const sunraysShader = `
                precision highp float;
                varying vec2 vUv;
                uniform sampler2D uTexture;
                uniform float weight;
                
                void main() {
                    float sunrays = texture2D(uTexture, vUv).r;
                    sunrays *= sunrays; // Enhance contrast
                    gl_FragColor = vec4(sunrays * weight, 0.0, 0.0, 1.0);
                }
            `;

            // Sunrays mask shader - creates mask for sunrays
            const sunraysMaskShader = `
                precision highp float;
                varying vec2 vUv;
                uniform sampler2D uTexture;
                
                void main() {
                    vec3 color = texture2D(uTexture, vUv).rgb;
                    float brightness = max(color.r, max(color.g, color.b));
                    brightness = max(0.0, brightness - 0.5); // Threshold
                    gl_FragColor = vec4(brightness, 0.0, 0.0, 1.0);
                }
            `;

            // Compile all shaders into programs
            return {
                clear: this.compileShader(baseVertexShader, clearShader),
                display: this.compileShader(baseVertexShader, displayShader),
                splat: this.compileShader(baseVertexShader, splatShader),
                advection: this.compileShader(baseVertexShader, advectionShader),
                divergence: this.compileShader(baseVertexShader, divergenceShader),
                curl: this.compileShader(baseVertexShader, curlShader),
                vorticity: this.compileShader(baseVertexShader, vorticityShader),
                pressure: this.compileShader(baseVertexShader, pressureShader),
                gradientSubtract: this.compileShader(baseVertexShader, gradientSubtractShader),
                bloomPrefilter: this.compileShader(baseVertexShader, bloomPrefilterShader),
                bloomBlur: this.compileShader(baseVertexShader, bloomBlurShader),
                bloomFinal: this.compileShader(baseVertexShader, bloomFinalShader),
                sunrays: this.compileShader(baseVertexShader, sunraysShader),
                sunraysMask: this.compileShader(baseVertexShader, sunraysMaskShader)
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

            gl.deleteShader(vertexShader);
            gl.deleteShader(fragmentShader);

            return program;
        }

        createFramebuffers() {
            const gl = this.gl;
            const ext = this.ext;
            
            // Get simulation resolution based on canvas size and downsample factor
            const simRes = this.getResolution(this.config.DOWNSAMPLE);
            const dyeRes = this.getResolution(this.config.DOWNSAMPLE);
            
            // Texel size for simulation
            this.texelSize = {
                x: 1.0 / simRes.width,
                y: 1.0 / simRes.height
            };
            
            this.dyeTexelSize = {
                x: 1.0 / dyeRes.width,
                y: 1.0 / dyeRes.height
            };

            // Create vertex buffer for a quad covering the viewport
            const buffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
            
            // Create framebuffers for simulation
            try {
                // Create double framebuffer for velocity
                this.velocity = this.createDoubleFBO(simRes.width, simRes.height);
                
                // Create double framebuffer for density (color)
                this.density = this.createDoubleFBO(dyeRes.width, dyeRes.height);
                
                // Create framebuffer for divergence
                this.divergence = this.createFBO(simRes.width, simRes.height);
                
                // Create framebuffer for curl
                this.curl = this.createFBO(simRes.width, simRes.height);
                
                // Create double framebuffer for pressure
                this.pressure = this.createDoubleFBO(simRes.width, simRes.height);
                
                // Create framebuffers for bloom effect
                if (this.config.BLOOM) {
                    const bloomRes = this.getResolution(this.config.BLOOM_RESOLUTION);
                    this.bloom = this.createFBO(bloomRes.width, bloomRes.height);
                    this.bloomFramebuffers = [];
                    for (let i = 0; i < this.config.BLOOM_ITERATIONS; i++) {
                        let width = bloomRes.width >> (i + 1);
                        let height = bloomRes.height >> (i + 1);
                        
                        if (width < 2) width = 2;
                        if (height < 2) height = 2;
                        
                        this.bloomFramebuffers.push(this.createFBO(width, height));
                        this.bloomFramebuffers.push(this.createFBO(width, height));
                    }
                }
                
                // Create framebuffers for sunrays effect
                if (this.config.SUNRAYS) {
                    const sunraysRes = this.getResolution(this.config.SUNRAYS_RESOLUTION);
                    this.sunrays = this.createFBO(sunraysRes.width, sunraysRes.height);
                    this.sunraysTemp = this.createFBO(sunraysRes.width, sunraysRes.height);
                }
                
                // Clear all framebuffers to initial state
                this.clear(this.velocity.read);
                this.clear(this.velocity.write);
                this.clear(this.density.read);
                this.clear(this.density.write);
                this.clear(this.pressure.read);
                this.clear(this.pressure.write);
                this.clear(this.divergence);
                this.clear(this.curl);
                
                if (this.config.BLOOM) {
                    this.clear(this.bloom);
                    for (let i = 0; i < this.bloomFramebuffers.length; i++) {
                        this.clear(this.bloomFramebuffers[i]);
                    }
                }
                
                if (this.config.SUNRAYS) {
                    this.clear(this.sunrays);
                    this.clear(this.sunraysTemp);
                }
            } catch (error) {
                console.error('Error creating framebuffers:', error);
                throw new Error('WebGL framebuffer creation failed');
            }
        }

        getResolution(resolution) {
            let aspectRatio = this.gl.drawingBufferWidth / this.gl.drawingBufferHeight;
            
            if (aspectRatio < 1) {
                aspectRatio = 1.0 / aspectRatio;
            }
            
            // If resolution is 0, use full canvas size
            if (resolution === 0) {
                return {
                    width: this.gl.drawingBufferWidth,
                    height: this.gl.drawingBufferHeight
                };
            }
            
            const min = Math.round(resolution);
            const max = Math.round(resolution * aspectRatio);
            
            if (this.gl.drawingBufferWidth > this.gl.drawingBufferHeight) {
                return { width: max, height: min };
            } else {
                return { width: min, height: max };
            }
        }

        createFBO(width, height) {
            const gl = this.gl;
            const ext = this.ext;
            
            // Create texture
            const texture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            
            // Use RGBA/UNSIGNED_BYTE - the most compatible format
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, ext.texType, null);
            
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
                height,
                attach(id) {
                    gl.activeTexture(gl.TEXTURE0 + id);
                    gl.bindTexture(gl.TEXTURE_2D, texture);
                    return id;
                }
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
            
            gl.useProgram(this.programs.clear);
            gl.uniform4f(gl.getUniformLocation(this.programs.clear, 'color'), 0, 0, 0, 1);
            
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
            
            // Calculate curl
            gl.useProgram(this.programs.curl);
            gl.uniform2f(gl.getUniformLocation(this.programs.curl, 'texelSize'), this.texelSize.x, this.texelSize.y);
            gl.uniform1i(gl.getUniformLocation(this.programs.curl, 'uVelocity'), this.velocity.read.attach(0));
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.curl.fbo);
            gl.viewport(0, 0, this.curl.width, this.curl.height);
            this.blit();
            
            // Apply vorticity (swirl)
            gl.useProgram(this.programs.vorticity);
            gl.uniform2f(gl.getUniformLocation(this.programs.vorticity, 'texelSize'), this.texelSize.x, this.texelSize.y);
            gl.uniform1i(gl.getUniformLocation(this.programs.vorticity, 'uVelocity'), this.velocity.read.attach(0));
            gl.uniform1i(gl.getUniformLocation(this.programs.vorticity, 'uCurl'), this.curl.attach(1));
            gl.uniform1f(gl.getUniformLocation(this.programs.vorticity, 'curl'), this.config.CURL);
            gl.uniform1f(gl.getUniformLocation(this.programs.vorticity, 'dt'), dt);
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.velocity.write.fbo);
            gl.viewport(0, 0, this.velocity.width, this.velocity.height);
            this.blit();
            this.velocity.swap();
            
            // Calculate divergence
            gl.useProgram(this.programs.divergence);
            gl.uniform2f(gl.getUniformLocation(this.programs.divergence, 'texelSize'), this.texelSize.x, this.texelSize.y);
            gl.uniform1i(gl.getUniformLocation(this.programs.divergence, 'uVelocity'), this.velocity.read.attach(0));
            gl.uniform1f(gl.getUniformLocation(this.programs.divergence, 'halfrdx'), 0.5 / this.texelSize.x);
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.divergence.fbo);
            gl.viewport(0, 0, this.divergence.width, this.divergence.height);
            this.blit();
            
            // Clear pressure
            this.clear(this.pressure.read);
            
            // Solve pressure
            gl.useProgram(this.programs.pressure);
            gl.uniform2f(gl.getUniformLocation(this.programs.pressure, 'texelSize'), this.texelSize.x, this.texelSize.y);
            gl.uniform1i(gl.getUniformLocation(this.programs.pressure, 'uDivergence'), this.divergence.attach(0));
            
            // Pressure iterations
            for (let i = 0; i < this.config.PRESSURE_ITERATIONS; i++) {
                gl.uniform1i(gl.getUniformLocation(this.programs.pressure, 'uPressure'), this.pressure.read.attach(1));
                gl.bindFramebuffer(gl.FRAMEBUFFER, this.pressure.write.fbo);
                gl.viewport(0, 0, this.pressure.width, this.pressure.height);
                this.blit();
                this.pressure.swap();
            }
            
            // Apply pressure gradient
            gl.useProgram(this.programs.gradientSubtract);
            gl.uniform2f(gl.getUniformLocation(this.programs.gradientSubtract, 'texelSize'), this.texelSize.x, this.texelSize.y);
            gl.uniform1i(gl.getUniformLocation(this.programs.gradientSubtract, 'uPressure'), this.pressure.read.attach(0));
            gl.uniform1i(gl.getUniformLocation(this.programs.gradientSubtract, 'uVelocity'), this.velocity.read.attach(1));
            gl.uniform1f(gl.getUniformLocation(this.programs.gradientSubtract, 'halfrdx'), 0.5 / this.texelSize.x);
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.velocity.write.fbo);
            gl.viewport(0, 0, this.velocity.width, this.velocity.height);
            this.blit();
            this.velocity.swap();
            
            // Advect velocity
            gl.useProgram(this.programs.advection);
            gl.uniform2f(gl.getUniformLocation(this.programs.advection, 'texelSize'), this.texelSize.x, this.texelSize.y);
            gl.uniform1i(gl.getUniformLocation(this.programs.advection, 'uVelocity'), this.velocity.read.attach(0));
            gl.uniform1i(gl.getUniformLocation(this.programs.advection, 'uSource'), this.velocity.read.attach(0));
            gl.uniform1f(gl.getUniformLocation(this.programs.advection, 'dt'), dt);
            gl.uniform1f(gl.getUniformLocation(this.programs.advection, 'dissipation'), this.config.VELOCITY_DISSIPATION);
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.velocity.write.fbo);
            gl.viewport(0, 0, this.velocity.width, this.velocity.height);
            this.blit();
            this.velocity.swap();
            
            // Advect density (color)
            gl.useProgram(this.programs.advection);
            gl.uniform2f(gl.getUniformLocation(this.programs.advection, 'texelSize'), this.dyeTexelSize.x, this.dyeTexelSize.y);
            gl.uniform1i(gl.getUniformLocation(this.programs.advection, 'uVelocity'), this.velocity.read.attach(0));
            gl.uniform1i(gl.getUniformLocation(this.programs.advection, 'uSource'), this.density.read.attach(1));
            gl.uniform1f(gl.getUniformLocation(this.programs.advection, 'dissipation'), this.config.DENSITY_DISSIPATION);
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.density.write.fbo);
            gl.viewport(0, 0, this.density.width, this.density.height);
            this.blit();
            this.density.swap();
        }

        render() {
            if (!this.gl) return;
            
            // Update simulation
            this.update();
            
            // Apply bloom effect
            if (this.config.BLOOM) {
                this.applyBloom();
            }
            
            // Apply sunrays effect
            if (this.config.SUNRAYS) {
                this.applySunrays();
            }
            
            // Draw to screen
            this.drawDisplay();
            
            // Continue animation loop
            requestAnimationFrame(() => this.render());
        }

        applyBloom() {
            const gl = this.gl;
            
            // Extract bright areas
            gl.useProgram(this.programs.bloomPrefilter);
            gl.uniform3f(gl.getUniformLocation(this.programs.bloomPrefilter, 'curve'), 
                this.config.BLOOM_SOFT_KNEE, this.config.BLOOM_THRESHOLD, 
                this.config.BLOOM_SOFT_KNEE * 2.0);
            gl.uniform1f(gl.getUniformLocation(this.programs.bloomPrefilter, 'threshold'), 
                this.config.BLOOM_THRESHOLD);
            gl.uniform1i(gl.getUniformLocation(this.programs.bloomPrefilter, 'uTexture'), 
                this.density.read.attach(0));
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloom.fbo);
            gl.viewport(0, 0, this.bloom.width, this.bloom.height);
            this.blit();
            
            // Apply blur in multiple passes
            gl.useProgram(this.programs.bloomBlur);
            
            // Blur horizontally and vertically
            let source = this.bloom;
            for (let i = 0; i < this.bloomFramebuffers.length; i += 2) {
                const dest1 = this.bloomFramebuffers[i];
                const dest2 = this.bloomFramebuffers[i + 1];
                
                // Horizontal blur
                gl.uniform2f(gl.getUniformLocation(this.programs.bloomBlur, 'texelSize'), 
                    1.0 / source.width, 1.0 / source.height);
                gl.uniform2f(gl.getUniformLocation(this.programs.bloomBlur, 'direction'), 1.0, 0.0);
                gl.uniform1i(gl.getUniformLocation(this.programs.bloomBlur, 'uTexture'), 
                    source.attach(0));
                gl.bindFramebuffer(gl.FRAMEBUFFER, dest1.fbo);
                gl.viewport(0, 0, dest1.width, dest1.height);
                this.blit();
                
                // Vertical blur
                gl.uniform2f(gl.getUniformLocation(this.programs.bloomBlur, 'direction'), 0.0, 1.0);
                gl.uniform1i(gl.getUniformLocation(this.programs.bloomBlur, 'uTexture'), 
                    dest1.attach(0));
                gl.bindFramebuffer(gl.FRAMEBUFFER, dest2.fbo);
                gl.viewport(0, 0, dest2.width, dest2.height);
                this.blit();
                
                source = dest2;
            }
        }

        applySunrays() {
            const gl = this.gl;
            
            // Create mask
            gl.useProgram(this.programs.sunraysMask);
            gl.uniform1i(gl.getUniformLocation(this.programs.sunraysMask, 'uTexture'), 
                this.density.read.attach(0));
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.sunraysTemp.fbo);
            gl.viewport(0, 0, this.sunraysTemp.width, this.sunraysTemp.height);
            this.blit();
            
            // Apply sunrays
            gl.useProgram(this.programs.sunrays);
            gl.uniform1i(gl.getUniformLocation(this.programs.sunrays, 'uTexture'), 
                this.sunraysTemp.attach(0));
            gl.uniform1f(gl.getUniformLocation(this.programs.sunrays, 'weight'), 
                this.config.SUNRAYS_WEIGHT);
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.sunrays.fbo);
            gl.viewport(0, 0, this.sunrays.width, this.sunrays.height);
            this.blit();
        }

        drawDisplay() {
            const gl = this.gl;
            
            // Set up display program
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
            
            // Draw background color
            gl.useProgram(this.programs.clear);
            gl.uniform4f(gl.getUniformLocation(this.programs.clear, 'color'), 
                this.config.BACK_COLOR.r, this.config.BACK_COLOR.g, this.config.BACK_COLOR.b, 1);
            this.blit();
            
            // Draw fluid
            gl.useProgram(this.programs.display);
            gl.uniform1i(gl.getUniformLocation(this.programs.display, 'uTexture'), 
                this.density.read.attach(0));
            gl.uniform1f(gl.getUniformLocation(this.programs.display, 'uAlpha'), 1.0);
            
            // Apply bloom if enabled
            if (this.config.BLOOM) {
                gl.uniform1i(gl.getUniformLocation(this.programs.bloomFinal, 'uTexture'), 
                    this.density.read.attach(0));
                gl.uniform1i(gl.getUniformLocation(this.programs.bloomFinal, 'uBloom'), 
                    this.bloomFramebuffers[this.bloomFramebuffers.length - 1].attach(1));
                gl.uniform1f(gl.getUniformLocation(this.programs.bloomFinal, 'intensity'), 
                    this.config.BLOOM_INTENSITY);
            }
            
            this.blit();
        }

        multipleSplats(amount) {
            for (let i = 0; i < amount; i++) {
                // Create random positions with bias towards center
                const x = Math.random() * 0.6 + 0.2;
                const y = Math.random() * 0.6 + 0.2;
                
                // Get color from palette with variation
                const color = this.getColorFromPalette();
                
                // Apply splat with random velocity
                const dx = (Math.random() * 2 - 1) * 0.01;
                const dy = (Math.random() * 2 - 1) * 0.01;
                
                // Vary the splat radius
                const radius = this.config.SPLAT_RADIUS * (0.5 + Math.random() * 1.0);
                
                // Apply splat
                this.splat(x, y, dx, dy, color, radius);
            }
        }

        splatPointer(pointer) {
            // Calculate velocity from pointer movement
            const dx = pointer.deltaX * this.config.SPLAT_FORCE;
            const dy = pointer.deltaY * this.config.SPLAT_FORCE;
            
            // Apply splat with larger radius for more dramatic effect
            this.splat(
                pointer.texcoordX,
                pointer.texcoordY,
                dx,
                dy,
                pointer.color,
                this.config.SPLAT_RADIUS * 1.5
            );
        }

        splat(x, y, dx, dy, color, radius) {
            const gl = this.gl;
            
            // Apply velocity
            gl.useProgram(this.programs.splat);
            gl.uniform1i(gl.getUniformLocation(this.programs.splat, 'uTarget'), 0);
            gl.uniform1f(gl.getUniformLocation(this.programs.splat, 'aspectRatio'), 
                this.canvas.width / this.canvas.height);
            gl.uniform2f(gl.getUniformLocation(this.programs.splat, 'point'), x, y);
            gl.uniform3f(gl.getUniformLocation(this.programs.splat, 'color'), 
                dx, -dy, 0);
            gl.uniform1f(gl.getUniformLocation(this.programs.splat, 'radius'), radius);
            
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.velocity.read.texture);
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.velocity.write.fbo);
            gl.viewport(0, 0, this.velocity.width, this.velocity.height);
            this.blit();
            this.velocity.swap();
            
            // Apply color
            gl.uniform1i(gl.getUniformLocation(this.programs.splat, 'uTarget'), 0);
            gl.uniform3f(gl.getUniformLocation(this.programs.splat, 'color'), 
                color.r, color.g, color.b);
            
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.density.read.texture);
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.density.write.fbo);
            gl.viewport(0, 0, this.density.width, this.density.height);
            this.blit();
            this.density.swap();
        }

        startAutoSplats() {
            // Create initial splats
            this.multipleSplats(5);
            
            // Set up interval for continuous motion
            setInterval(() => {
                if (!this.config.PAUSED) {
                    this.multipleSplats(Math.floor(Math.random() * 2) + 1);
                }
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
