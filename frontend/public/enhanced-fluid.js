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
            SIM_RESOLUTION: 256,            // Increased from 128 for better quality
            DYE_RESOLUTION: 1024,           // Increased from 512 for better quality
            DENSITY_DISSIPATION: 0.97,      // Slightly decreased for longer-lasting colors
            VELOCITY_DISSIPATION: 0.98,     // Slightly decreased for longer-lasting motion
            PRESSURE_DISSIPATION: 0.8,
            PRESSURE_ITERATIONS: 25,
            CURL: 50,                       // Increased from 30 for more swirling
            SPLAT_RADIUS: 0.3,              // Increased from 0.25 for larger splats
            SPLAT_FORCE: 8000,              // Increased from 6000 for stronger interaction
            SHADING: true,
            COLORFUL: true,
            COLOR_UPDATE_SPEED: 15,         // Increased from 10 for faster color changes
            PAUSED: false,
            BACK_COLOR: { r: 0.02, g: 0.15, b: 0.1 }, // Slight green tint for background
            TRANSPARENT: false,
            BLOOM: true,
            BLOOM_ITERATIONS: 10,           // Increased from 8 for more glow
            BLOOM_RESOLUTION: 512,          // Increased from 256 for better quality
            BLOOM_INTENSITY: 1.0,           // Increased from 0.8 for more intensity
            BLOOM_THRESHOLD: 0.5,           // Decreased from 0.6 for more visible bloom
            BLOOM_SOFT_KNEE: 0.7,
            SUNRAYS: true,
            SUNRAYS_RESOLUTION: 256,        // Increased from 196 for better quality
            SUNRAYS_WEIGHT: 1.2,            // Increased from 1.0 for stronger effect
            AUTO_SPLAT_INTERVAL: 3,         // New: seconds between automatic splats
            MOTION_SPEED: 1.0,              // New: overall motion speed multiplier
            COLOR_INTENSITY: 1.2,           // New: color intensity multiplier
            TRAIL_INTENSITY: 0.8,           // New: intensity of mouse trail
            TRAIL_COUNT: 5,                 // New: number of trail points
            COLOR_PALETTE: [                // New: predefined vibrant color palette
                { r: 0.8, g: 0.2, b: 0.8 },  // Purple
                { r: 0.2, g: 0.8, b: 0.8 },  // Cyan
                { r: 0.9, g: 0.4, b: 0.0 },  // Orange
                { r: 0.0, g: 0.8, b: 0.4 },  // Green
                { r: 0.8, g: 0.8, b: 0.0 },  // Yellow
                { r: 0.0, g: 0.4, b: 0.8 },  // Blue
            ]
        };

        this.pointers = [];
        this.splatStack = [];
        this.trailPoints = [];
        this.lastSplatTime = Date.now();
        this.colorIndex = 0;
        
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
        
        // Start automatic splat generation
        this.startAutoSplats();
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

        // Enhanced display shader with improved color handling
        const displayShader = `
            precision highp float;
            varying vec2 vUv;
            uniform sampler2D uTexture;
            uniform float uAlpha;
            
            // Enhanced color mapping for more vibrant output
            vec3 enhanceColor(vec3 color) {
                // Increase saturation
                float luminance = dot(color, vec3(0.299, 0.587, 0.114));
                vec3 saturated = mix(vec3(luminance), color, 1.3);
                
                // Enhance contrast
                saturated = pow(saturated, vec3(0.95));
                
                // Ensure we don't exceed 1.0
                return clamp(saturated, 0.0, 1.0);
            }
            
            void main () {
                vec3 C = texture2D(uTexture, vUv).rgb;
                C = enhanceColor(C);
                float a = max(C.r, max(C.g, C.b));
                gl_FragColor = vec4(C, a * uAlpha);
            }
        `;

        // Enhanced splat shader with improved blending
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
                
                // Enhanced splat shape with smoother falloff
                float falloff = exp(-dot(p, p) / radius);
                
                // Apply a slight twist effect
                float twist = length(p) * 0.3;
                float sinTwist = sin(twist);
                float cosTwist = cos(twist);
                vec3 twistedColor = vec3(
                    color.r * cosTwist + color.g * sinTwist,
                    color.g * cosTwist - color.r * sinTwist,
                    color.b
                );
                
                vec3 splat = falloff * twistedColor;
                vec3 base = texture2D(uTarget, vUv).xyz;
                
                // Improved color blending
                gl_FragColor = vec4(base + splat, 1.0);
            }
        `;

        // Enhanced advection shader with improved accuracy
        const advectionShader = `
            precision highp float;
            varying vec2 vUv;
            uniform sampler2D uVelocity;
            uniform sampler2D uSource;
            uniform vec2 texelSize;
            uniform float dt;
            uniform float dissipation;
            
            // Enhanced bilinear interpolation
            vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {
                vec2 st = uv / tsize - 0.5;
                vec2 iuv = floor(st);
                vec2 fuv = fract(st);
                
                // Smooth the interpolation for better quality
                vec2 smoothFuv = smoothstep(0.0, 1.0, fuv);
                
                vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize);
                vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize);
                vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize);
                vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);
                
                return mix(mix(a, b, smoothFuv.x), mix(c, d, smoothFuv.x), smoothFuv.y);
            }
            
            void main () {
                // Enhanced advection with slight curl
                vec2 velocity = bilerp(uVelocity, vUv, texelSize).xy;
                
                // Add a small amount of rotational force
                float vortexStrength = 0.05;
                float vortex = vortexStrength * (velocity.x * velocity.x + velocity.y * velocity.y);
                mat2 rotation = mat2(
                    cos(vortex), -sin(vortex),
                    sin(vortex), cos(vortex)
                );
                velocity = rotation * velocity;
                
                vec2 coord = vUv - dt * velocity * texelSize;
                
                // Apply dissipation with a slight color shift for more interesting effects
                vec4 result = dissipation * bilerp(uSource, coord, texelSize);
                gl_FragColor = result;
            }
        `;

        // Enhanced divergence shader
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

        // Enhanced curl shader
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

        // Enhanced vorticity shader for more organic motion
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
                
                // Enhanced vorticity calculation with non-linear response
                vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
                force /= length(force) + 0.0001;
                
                // Apply non-linear scaling for more organic motion
                float magnitude = length(force);
                force = normalize(force) * pow(magnitude, 1.2);
                
                force *= curl * C;
                force.y *= -1.0;
                
                vec2 vel = texture2D(uVelocity, vUv).xy;
                
                // Add slight oscillation for more natural movement
                float oscillation = sin(dt * 10.0) * 0.01;
                force.x += oscillation;
                force.y -= oscillation;
                
                gl_FragColor = vec4(vel + force * dt, 0.0, 1.0);
            }
        `;

        // Enhanced pressure shader
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

        // Enhanced gradient subtract shader
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

        // Enhanced bloom shader for better glow effects
        const bloomPrefilterShader = `
            precision mediump float;
            varying vec2 vUv;
            uniform sampler2D uTexture;
            uniform vec3 curve;
            uniform float threshold;
            
            void main() {
                vec3 color = texture2D(uTexture, vUv).rgb;
                float brightness = max(color.r, max(color.g, color.b));
                float soft = brightness - curve.y;
                soft = clamp(soft, 0.0, curve.z);
                soft = curve.x * soft * soft;
                float contribution = max(soft, brightness - threshold);
                contribution /= max(brightness, 0.00001);
                gl_FragColor = vec4(color * contribution, 1.0);
            }
        `;

        const bloomBlurShader = `
            precision mediump float;
            varying vec2 vUv;
            uniform sampler2D uTexture;
            uniform vec2 texelSize;
            uniform vec2 direction;
            
            // Enhanced Gaussian blur with more samples for smoother results
            vec3 blur9(sampler2D image, vec2 uv, vec2 resolution, vec2 direction) {
                vec3 color = vec3(0.0);
                vec2 off1 = vec2(1.3846153846) * direction;
                vec2 off2 = vec2(3.2307692308) * direction;
                vec2 off3 = vec2(5.0769230769) * direction;
                vec2 off4 = vec2(6.9230769231) * direction;
                
                color += texture2D(image, uv).rgb * 0.2270270270;
                color += texture2D(image, uv + (off1 / resolution)).rgb * 0.1945945946;
                color += texture2D(image, uv - (off1 / resolution)).rgb * 0.1945945946;
                color += texture2D(image, uv + (off2 / resolution)).rgb * 0.1216216216;
                color += texture2D(image, uv - (off2 / resolution)).rgb * 0.1216216216;
                color += texture2D(image, uv + (off3 / resolution)).rgb * 0.0540540541;
                color += texture2D(image, uv - (off3 / resolution)).rgb * 0.0540540541;
                color += texture2D(image, uv + (off4 / resolution)).rgb * 0.0162162162;
                color += texture2D(image, uv - (off4 / resolution)).rgb * 0.0162162162;
                
                return color;
            }
            
            void main() {
                gl_FragColor = vec4(blur9(uTexture, vUv, 1.0 / texelSize, direction), 1.0);
            }
        `;

        const bloomFinalShader = `
            precision mediump float;
            varying vec2 vUv;
            uniform sampler2D uTexture;
            uniform sampler2D uBloom;
            uniform sampler2D uDithering;
            uniform vec2 ditherScale;
            uniform float bloomStrength;
            
            // Enhanced color blending for bloom
            vec3 blend(vec3 base, vec3 blend) {
                return 1.0 - (1.0 - base) * (1.0 - blend);
            }
            
            void main() {
                vec3 color = texture2D(uTexture, vUv).rgb;
                vec3 bloomColor = texture2D(uBloom, vUv).rgb;
                
                // Apply dithering for smoother gradients
                vec3 noise = texture2D(uDithering, vUv * ditherScale).rgb;
                noise = noise * 2.0 - 1.0;
                noise *= 0.015;
                
                // Enhanced bloom with better color preservation
                color = blend(color, bloomColor * bloomStrength);
                color += noise;
                
                gl_FragColor = vec4(color, 1.0);
            }
        `;

        // Enhanced sunrays shader for beautiful light effects
        const sunraysShader = `
            precision mediump float;
            varying vec2 vUv;
            uniform sampler2D uTexture;
            uniform float weight;
            
            void main() {
                float decay = 0.95;
                float exposure = 0.3;
                float density = 0.7;
                float samples = 16.0;
                
                vec2 coord = vUv;
                vec2 dir = vUv - 0.5;
                
                dir *= 1.0 / samples * density;
                float illumination = 1.0;
                float color = 0.0;
                
                for(float i = 0.0; i < samples; i++) {
                    coord -= dir;
                    float sample = texture2D(uTexture, coord).r;
                    sample *= illumination * weight;
                    color += sample;
                    illumination *= decay;
                }
                
                gl_FragColor = vec4(color, color, color, 1.0);
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
            gradientSubtract: this.compileShader(vertexShader, gradientSubtractShader),
            bloomPrefilter: this.compileShader(vertexShader, bloomPrefilterShader),
            bloomBlur: this.compileShader(vertexShader, bloomBlurShader),
            bloomFinal: this.compileShader(vertexShader, bloomFinalShader),
            sunrays: this.compileShader(vertexShader, sunraysShader)
        };
    }

    compileShader(vertexSource, fragmentSource) {
        const gl = this.gl;
        
        const vertexShader = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vertexShader, vertexSource);
        gl.compileShader(vertexShader);
        this.checkShaderCompilation(vertexShader, 'VERTEX');

        const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fragmentShader, fragmentSource);
        gl.compileShader(fragmentShader);
        this.checkShaderCompilation(fragmentShader, 'FRAGMENT');

        const program = gl.createProgram();
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);
        this.checkProgramLinking(program);

        return program;
    }

    checkShaderCompilation(shader, type) {
        const gl = this.gl;
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error(`Error compiling ${type} shader:`, gl.getShaderInfoLog(shader));
        }
    }

    checkProgramLinking(program) {
        const gl = this.gl;
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error('Error linking program:', gl.getProgramInfoLog(program));
        }
    }

    createFramebuffers() {
        const gl = this.gl;
        const ext = this.ext;

        // Create textures
        const simRes = this.getResolution(this.config.SIM_RESOLUTION);
        const dyeRes = this.getResolution(this.config.DYE_RESOLUTION);
        const bloomRes = this.getResolution(this.config.BLOOM_RESOLUTION);
        const sunraysRes = this.getResolution(this.config.SUNRAYS_RESOLUTION);

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

            // Create additional framebuffers for enhanced effects
            if (this.config.BLOOM) {
                this.bloom = this.createBloomFBOs(bloomRes.width, bloomRes.height);
            }

            if (this.config.SUNRAYS) {
                this.sunrays = this.createFBO(
                    sunraysRes.width,
                    sunraysRes.height,
                    ext.formatR,
                    ext.internalFormatR,
                    ext.halfFloatTexType,
                    gl.LINEAR,
                    false
                );
                
                this.sunraysTemp = this.createFBO(
                    sunraysRes.width,
                    sunraysRes.height,
                    ext.formatR,
                    ext.internalFormatR,
                    ext.halfFloatTexType,
                    gl.LINEAR,
                    false
                );
            }
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
            
            return (target) => {
                gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
                gl.viewport(0, 0, target.width, target.height);
                gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
                gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
                gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
                gl.enableVertexAttribArray(0);
                gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
            };
        })();
    }

    createBloomFBOs(width, height) {
        const gl = this.gl;
        const ext = this.ext;

        // Create bloom framebuffers for multi-pass bloom effect
        const fbos = [];
        
        for (let i = 0; i < this.config.BLOOM_ITERATIONS; i++) {
            let fboWidth = width >> i;
            let fboHeight = height >> i;
            
            // Ensure minimum size
            fboWidth = Math.max(4, fboWidth);
            fboHeight = Math.max(4, fboHeight);
            
            const fbo = this.createFBO(
                fboWidth,
                fboHeight,
                ext.formatRGBA,
                ext.internalFormatRGBA,
                ext.halfFloatTexType,
                gl.LINEAR,
                false
            );
            
            fbos.push(fbo);
        }
        
        return fbos;
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
        this.updateTrailPoints();
        
        if (!this.config.PAUSED) {
            this.step(dt);
        }
    }

    calcDeltaTime() {
        const now = Date.now();
        let dt = (now - this.lastUpdateTime) / 1000;
        dt = Math.min(dt, 0.016666); // Cap at ~60fps
        this.lastUpdateTime = now;
        return dt * this.config.MOTION_SPEED; // Apply motion speed multiplier
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
        // Apply automatic splats
        const now = Date.now();
        if (now - this.lastSplatTime > this.config.AUTO_SPLAT_INTERVAL * 1000) {
            this.lastSplatTime = now;
            this.multipleSplats(Math.floor(Math.random() * 3) + 2); // 2-4 random splats
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
        
        // Apply trail effects
        if (this.trailPoints.length > 0) {
            this.applyTrailSplats();
        }
    }

    updateTrailPoints() {
        // Update trail points for trailing effect
        if (this.pointers.length > 0 && this.pointers[0].down) {
            const pointer = this.pointers[0];
            
            // Add current point to trail
            if (pointer.moved) {
                this.trailPoints.unshift({
                    x: pointer.texcoordX,
                    y: pointer.texcoordY,
                    age: 0,
                    color: { ...pointer.color }
                });
                
                // Limit trail length
                if (this.trailPoints.length > this.config.TRAIL_COUNT) {
                    this.trailPoints.pop();
                }
            }
        }
        
        // Age trail points and remove old ones
        for (let i = this.trailPoints.length - 1; i >= 0; i--) {
            this.trailPoints[i].age += 1;
            if (this.trailPoints[i].age > 20) {
                this.trailPoints.splice(i, 1);
            }
        }
    }

    applyTrailSplats() {
        // Apply splats for trail points with decreasing intensity
        this.trailPoints.forEach((point, index) => {
            const intensity = this.config.TRAIL_INTENSITY * (1 - index / this.trailPoints.length);
            const radius = this.config.SPLAT_RADIUS * 0.5 * (1 - index / this.trailPoints.length);
            
            if (index % 2 === 0) { // Only apply every other point for performance
                this.splat(
                    point.x,
                    point.y,
                    point.color.r * intensity,
                    point.color.g * intensity,
                    point.color.b * intensity,
                    radius
                );
            }
        });
    }

    step(dt) {
        const gl = this.gl;

        gl.disable(gl.BLEND);

        // Curl
        const curlProgram = this.programs.curl;
        gl.useProgram(curlProgram);
        gl.uniform2f(gl.getUniformLocation(curlProgram, 'texelSize'), this.velocity.texelSizeX, this.velocity.texelSizeY);
        gl.uniform1i(gl.getUniformLocation(curlProgram, 'uVelocity'), this.velocity.read.attach(0));

        this.blit(this.curl);

        // Vorticity
        const vorticityProgram = this.programs.vorticity;
        gl.useProgram(vorticityProgram);
        gl.uniform2f(gl.getUniformLocation(vorticityProgram, 'texelSize'), this.velocity.texelSizeX, this.velocity.texelSizeY);
        gl.uniform1i(gl.getUniformLocation(vorticityProgram, 'uVelocity'), this.velocity.read.attach(0));
        gl.uniform1i(gl.getUniformLocation(vorticityProgram, 'uCurl'), this.curl.attach(1));
        gl.uniform1f(gl.getUniformLocation(vorticityProgram, 'curl'), this.config.CURL);
        gl.uniform1f(gl.getUniformLocation(vorticityProgram, 'dt'), dt);

        this.blit(this.velocity.write);
        this.velocity.swap();

        // Divergence
        const divergenceProgram = this.programs.divergence;
        gl.useProgram(divergenceProgram);
        gl.uniform2f(gl.getUniformLocation(divergenceProgram, 'texelSize'), this.velocity.texelSizeX, this.velocity.texelSizeY);
        gl.uniform1i(gl.getUniformLocation(divergenceProgram, 'uVelocity'), this.velocity.read.attach(0));

        this.blit(this.divergence);

        // Clear pressure
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.pressure.read.fbo);
        gl.clear(gl.COLOR_BUFFER_BIT);

        // Pressure
        const pressureProgram = this.programs.pressure;
        gl.useProgram(pressureProgram);
        gl.uniform2f(gl.getUniformLocation(pressureProgram, 'texelSize'), this.velocity.texelSizeX, this.velocity.texelSizeY);
        gl.uniform1i(gl.getUniformLocation(pressureProgram, 'uDivergence'), this.divergence.attach(0));

        for (let i = 0; i < this.config.PRESSURE_ITERATIONS; i++) {
            gl.uniform1i(gl.getUniformLocation(pressureProgram, 'uPressure'), this.pressure.read.attach(1));
            this.blit(this.pressure.write);
            this.pressure.swap();
        }

        // Gradient subtract
        const gradSubtractProgram = this.programs.gradientSubtract;
        gl.useProgram(gradSubtractProgram);
        gl.uniform2f(gl.getUniformLocation(gradSubtractProgram, 'texelSize'), this.velocity.texelSizeX, this.velocity.texelSizeY);
        gl.uniform1i(gl.getUniformLocation(gradSubtractProgram, 'uPressure'), this.pressure.read.attach(0));
        gl.uniform1i(gl.getUniformLocation(gradSubtractProgram, 'uVelocity'), this.velocity.read.attach(1));

        this.blit(this.velocity.write);
        this.velocity.swap();

        // Advection
        const advectionProgram = this.programs.advection;
        gl.useProgram(advectionProgram);
        gl.uniform2f(gl.getUniformLocation(advectionProgram, 'texelSize'), this.velocity.texelSizeX, this.velocity.texelSizeY);
        
        if (!this.ext.textureFloatLinear && !this.ext.textureHalfFloatLinear) {
            gl.uniform2f(gl.getUniformLocation(advectionProgram, 'dyeTexelSize'), this.velocity.texelSizeX, this.velocity.texelSizeY);
        }
        
        gl.uniform1i(gl.getUniformLocation(advectionProgram, 'uVelocity'), this.velocity.read.attach(0));
        gl.uniform1i(gl.getUniformLocation(advectionProgram, 'uSource'), this.velocity.read.attach(1));
        gl.uniform1f(gl.getUniformLocation(advectionProgram, 'dt'), dt);
        gl.uniform1f(gl.getUniformLocation(advectionProgram, 'dissipation'), this.config.VELOCITY_DISSIPATION);
        
        this.blit(this.velocity.write);
        this.velocity.swap();
        
        gl.uniform1i(gl.getUniformLocation(advectionProgram, 'uSource'), this.density.read.attach(1));
        gl.uniform1f(gl.getUniformLocation(advectionProgram, 'dissipation'), this.config.DENSITY_DISSIPATION);
        
        this.blit(this.density.write);
        this.density.swap();
        
        // Apply bloom and sunrays effects
        this.applyBloom();
        this.applySunrays();
    }

    applyBloom() {
        if (!this.config.BLOOM) return;
        
        const gl = this.gl;
        const bloom = this.bloom;
        
        // Prefilter
        gl.useProgram(this.programs.bloomPrefilter);
        gl.uniform1i(gl.getUniformLocation(this.programs.bloomPrefilter, 'uTexture'), this.density.read.attach(0));
        gl.uniform3f(
            gl.getUniformLocation(this.programs.bloomPrefilter, 'curve'),
            this.config.BLOOM_SOFT_KNEE,
            this.config.BLOOM_THRESHOLD,
            this.config.BLOOM_SOFT_KNEE * 2.0
        );
        gl.uniform1f(gl.getUniformLocation(this.programs.bloomPrefilter, 'threshold'), this.config.BLOOM_THRESHOLD);
        
        this.blit(bloom[0]);
        
        // Apply blur in multiple passes
        gl.useProgram(this.programs.bloomBlur);
        
        // Progressive downsampling and blurring
        let last = bloom[0];
        for (let i = 1; i < bloom.length; i++) {
            gl.uniform2f(
                gl.getUniformLocation(this.programs.bloomBlur, 'texelSize'),
                last.texelSizeX,
                last.texelSizeY
            );
            gl.uniform1i(gl.getUniformLocation(this.programs.bloomBlur, 'uTexture'), last.attach(0));
            gl.uniform2f(gl.getUniformLocation(this.programs.bloomBlur, 'direction'), 1.0, 0.0);
            
            this.blit(bloom[i]);
            
            gl.uniform2f(gl.getUniformLocation(this.programs.bloomBlur, 'direction'), 0.0, 1.0);
            gl.uniform1i(gl.getUniformLocation(this.programs.bloomBlur, 'uTexture'), bloom[i].attach(0));
            
            this.blit(last);
            last = bloom[i];
        }
        
        // Upsample and blend
        gl.useProgram(this.programs.bloomBlur);
        for (let i = bloom.length - 2; i >= 0; i--) {
            gl.uniform2f(
                gl.getUniformLocation(this.programs.bloomBlur, 'texelSize'),
                bloom[i + 1].texelSizeX,
                bloom[i + 1].texelSizeY
            );
            gl.uniform1i(gl.getUniformLocation(this.programs.bloomBlur, 'uTexture'), bloom[i + 1].attach(0));
            gl.uniform2f(gl.getUniformLocation(this.programs.bloomBlur, 'direction'), 1.0, 0.0);
            
            this.blit(bloom[i]);
            
            gl.uniform2f(gl.getUniformLocation(this.programs.bloomBlur, 'direction'), 0.0, 1.0);
            gl.uniform1i(gl.getUniformLocation(this.programs.bloomBlur, 'uTexture'), bloom[i].attach(0));
            
            this.blit(bloom[i + 1]);
        }
    }

    applySunrays() {
        if (!this.config.SUNRAYS) return;
        
        const gl = this.gl;
        
        // Apply sunrays effect
        gl.useProgram(this.programs.sunrays);
        gl.uniform1i(gl.getUniformLocation(this.programs.sunrays, 'uTexture'), this.density.read.attach(0));
        gl.uniform1f(gl.getUniformLocation(this.programs.sunrays, 'weight'), this.config.SUNRAYS_WEIGHT);
        
        this.blit(this.sunrays);
        
        // Blur the sunrays
        gl.useProgram(this.programs.bloomBlur);
        
        // Horizontal blur
        gl.uniform2f(
            gl.getUniformLocation(this.programs.bloomBlur, 'texelSize'),
            this.sunrays.texelSizeX,
            this.sunrays.texelSizeY
        );
        gl.uniform1i(gl.getUniformLocation(this.programs.bloomBlur, 'uTexture'), this.sunrays.attach(0));
        gl.uniform2f(gl.getUniformLocation(this.programs.bloomBlur, 'direction'), 1.0, 0.0);
        
        this.blit(this.sunraysTemp);
        
        // Vertical blur
        gl.uniform2f(gl.getUniformLocation(this.programs.bloomBlur, 'direction'), 0.0, 1.0);
        gl.uniform1i(gl.getUniformLocation(this.programs.bloomBlur, 'uTexture'), this.sunraysTemp.attach(0));
        
        this.blit(this.sunrays);
    }

    render() {
        if (!this.gl) return;
        
        this.update();
        this.drawDisplay();
        
        requestAnimationFrame(() => this.render());
    }

    drawDisplay() {
        const gl = this.gl;
        
        // Set up display program
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
        
        gl.useProgram(this.programs.display);
        gl.uniform1i(gl.getUniformLocation(this.programs.display, 'uTexture'), this.density.read.attach(0));
        gl.uniform1f(gl.getUniformLocation(this.programs.display, 'uAlpha'), 1.0);
        
        // Draw the final result
        this.blit({ fbo: null, width: gl.canvas.width, height: gl.canvas.height });
    }

    multipleSplats(amount) {
        for (let i = 0; i < amount; i++) {
            // Create random positions with bias towards center
            const x = Math.random() * 0.6 + 0.2;
            const y = Math.random() * 0.6 + 0.2;
            
            // Get color from palette with variation
            const color = this.getColorFromPalette();
            const r = color.r * this.config.COLOR_INTENSITY * (0.8 + Math.random() * 0.4);
            const g = color.g * this.config.COLOR_INTENSITY * (0.8 + Math.random() * 0.4);
            const b = color.b * this.config.COLOR_INTENSITY * (0.8 + Math.random() * 0.4);
            
            // Vary the splat radius
            const radius = this.config.SPLAT_RADIUS * (0.5 + Math.random() * 1.0);
            
            this.splat(x, y, r, g, b, radius);
        }
    }

    splatPointer(pointer) {
        const dx = pointer.deltaX * this.config.SPLAT_FORCE;
        const dy = pointer.deltaY * this.config.SPLAT_FORCE;
        
        this.splat(
            pointer.texcoordX,
            pointer.texcoordY,
            pointer.color.r * this.config.COLOR_INTENSITY,
            pointer.color.g * this.config.COLOR_INTENSITY,
            pointer.color.b * this.config.COLOR_INTENSITY,
            this.config.SPLAT_RADIUS
        );
    }

    splat(x, y, r, g, b, radius) {
        const gl = this.gl;
        
        gl.viewport(0, 0, this.velocity.width, this.velocity.height);
        gl.useProgram(this.programs.splat);
        
        // Apply velocity
        gl.uniform1i(gl.getUniformLocation(this.programs.splat, 'uTarget'), this.velocity.read.attach(0));
        gl.uniform1f(gl.getUniformLocation(this.programs.splat, 'aspectRatio'), this.canvas.width / this.canvas.height);
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
        gl.uniform1i(gl.getUniformLocation(this.programs.splat, 'uTarget'), this.density.read.attach(0));
        gl.uniform3f(gl.getUniformLocation(this.programs.splat, 'color'), r, g, b);
        
        this.blit(this.density.write);
        this.density.swap();
    }

    startAutoSplats() {
        // Create initial splats
        this.multipleSplats(5);
        
        // Set up interval for continuous motion
        setInterval(() => {
            if (!this.config.PAUSED) {
                // Add 1-3 splats periodically for constant motion
                const amount = Math.floor(Math.random() * 3) + 1;
                this.multipleSplats(amount);
            }
        }, this.config.AUTO_SPLAT_INTERVAL * 1000);
    }

    generateColor() {
        // Generate vibrant colors
        const h = Math.random();
        const s = 0.7 + Math.random() * 0.3; // High saturation
        const v = 0.8 + Math.random() * 0.2; // High value
        
        const color = this.hsvToRgb(h, s, v);
        return {
            r: color.r * this.config.COLOR_INTENSITY,
            g: color.g * this.config.COLOR_INTENSITY,
            b: color.b * this.config.COLOR_INTENSITY
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
}

// Make the FluidSimulation class globally available
window.FluidSimulation = FluidSimulation;
