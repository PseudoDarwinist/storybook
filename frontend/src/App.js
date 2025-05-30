import { useEffect, useRef, useState } from "react";
import "./App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;

const FloatingElement = ({ src, alt, size, position, delay = 0 }) => {
  const elementRef = useRef(null);
  
  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    
    let animationId;
    let startTime = null;
    
    const animate = (timestamp) => {
      if (!startTime) startTime = timestamp + delay * 1000;
      const elapsed = timestamp - startTime;
      
      // Create floating effect with 3D transforms
      const floatY = Math.sin(elapsed * 0.001) * 20;
      const floatX = Math.cos(elapsed * 0.0008) * 15;
      const rotateX = Math.sin(elapsed * 0.0005) * 2;
      const rotateY = Math.cos(elapsed * 0.0007) * 2;
      const scale = 1 + Math.sin(elapsed * 0.0012) * 0.05;
      
      element.style.transform = `translate3d(${floatX}px, ${floatY}px, 0px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(${scale})`;
      
      animationId = requestAnimationFrame(animate);
    };
    
    animationId = requestAnimationFrame(animate);
    
    return () => {
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
    };
  }, [delay]);
  
  return (
    <div 
      ref={elementRef}
      className={`absolute will-change-transform ${position}`}
      style={{ zIndex: 2 }}
    >
      <div className={`floating-image-container ${size}`}>
        <img 
          src={src} 
          alt={alt} 
          className="floating-image opacity-100 w-full h-full object-contain"
        />
      </div>
    </div>
  );
};

const FluidSimulation = () => {
  const canvasRef = useRef(null);
  const mouseRef = useRef({ x: 0, y: 0, prevX: 0, prevY: 0 });
  const fluidRef = useRef({
    velocityField: null,
    pressureField: null,
    dyeField: null,
    time: 0
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) {
      console.warn('WebGL not supported, falling back to 2D canvas');
      return;
    }

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    // Simplified fluid simulation with WebGL
    let animationId;
    let time = 0;
    
    // Vertex shader
    const vertexShader = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vertexShader, `
      attribute vec2 position;
      varying vec2 uv;
      void main() {
        uv = position * 0.5 + 0.5;
        gl_Position = vec4(position, 0.0, 1.0);
      }
    `);
    gl.compileShader(vertexShader);

    // Fragment shader for fluid effect
    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fragmentShader, `
      precision mediump float;
      varying vec2 uv;
      uniform float time;
      uniform vec2 mouse;
      uniform vec2 resolution;
      
      vec3 hsv2rgb(vec3 c) {
        vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
        vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
        return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
      }
      
      void main() {
        vec2 st = gl_FragCoord.xy / resolution.xy;
        vec2 center = vec2(0.5);
        
        // Create flowing fluid effect
        float t = time * 0.3;
        vec2 flow = st - center;
        float angle = atan(flow.y, flow.x);
        float radius = length(flow);
        
        // Mouse interaction - create disturbance
        vec2 mousePos = mouse / resolution.xy;
        float mouseDist = distance(st, mousePos);
        float mouseInfluence = smoothstep(0.15, 0.0, mouseDist);
        
        // Swirling motion
        float swirl = sin(angle * 3.0 + t + radius * 8.0) * 0.1;
        vec2 offset = vec2(cos(angle + swirl), sin(angle + swirl)) * radius * 0.3;
        
        // Color mixing and flowing
        float colorTime = t + mouseInfluence * 2.0;
        float hue1 = fract(colorTime * 0.1 + radius * 2.0 + sin(angle * 2.0) * 0.2);
        float hue2 = fract(colorTime * 0.15 + length(st + offset) * 1.5);
        
        // Green-teal base colors with fluid mixing
        float baseHue = 0.4 + sin(t * 0.2 + st.x * 3.0 + st.y * 2.0) * 0.1;
        vec3 color1 = hsv2rgb(vec3(baseHue, 0.8, 0.6));
        vec3 color2 = hsv2rgb(vec3(baseHue + 0.1, 0.9, 0.4));
        
        // Fluid displacement
        vec2 displacement = vec2(
          sin(st.x * 4.0 + t + mouseInfluence * 5.0) * 0.02,
          cos(st.y * 3.0 + t * 1.2 + mouseInfluence * 3.0) * 0.02
        );
        
        vec2 fluidSt = st + displacement + offset * mouseInfluence;
        
        // Blend colors based on fluid movement
        float mixer = sin(fluidSt.x * 6.0 + fluidSt.y * 4.0 + t * 2.0 + mouseInfluence * 8.0) * 0.5 + 0.5;
        vec3 finalColor = mix(color1, color2, mixer);
        
        // Add some shimmer and depth
        float shimmer = sin(st.x * 20.0 + t * 3.0) * sin(st.y * 15.0 + t * 2.0) * 0.1 + 0.9;
        finalColor *= shimmer;
        
        // Darken towards edges for the green gradient effect
        float vignette = smoothstep(1.2, 0.3, length(flow));
        finalColor *= vignette * 0.8 + 0.2;
        
        gl_FragColor = vec4(finalColor, 1.0);
      }
    `);
    gl.compileShader(fragmentShader);

    // Create shader program
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.useProgram(program);

    // Create quad vertices
    const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    const position = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    // Get uniform locations
    const timeUniform = gl.getUniformLocation(program, 'time');
    const mouseUniform = gl.getUniformLocation(program, 'mouse');
    const resolutionUniform = gl.getUniformLocation(program, 'resolution');

    const animate = () => {
      time += 0.016; // ~60fps
      
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      
      // Update uniforms
      gl.uniform1f(timeUniform, time);
      gl.uniform2f(mouseUniform, mouseRef.current.x, canvas.height - mouseRef.current.y);
      gl.uniform2f(resolutionUniform, canvas.width, canvas.height);
      
      // Draw
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      
      animationId = requestAnimationFrame(animate);
    };

    animate();

    const handleMouseMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current.prevX = mouseRef.current.x;
      mouseRef.current.prevY = mouseRef.current.y;
      mouseRef.current.x = e.clientX - rect.left;
      mouseRef.current.y = e.clientY - rect.top;
    };

    const handleResize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    document.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('resize', handleResize);

    return () => {
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
      document.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return (
    <canvas 
      ref={canvasRef}
      className="fixed inset-0 z-0 w-full h-full"
      style={{ background: 'linear-gradient(135deg, #064e3b 0%, #052e16 50%, #000000 100%)' }}
    />
  );
};

const CustomCursor = () => {
  const cursorRef = useRef(null);
  
  useEffect(() => {
    const cursor = cursorRef.current;
    if (!cursor) return;
    
    const handleMouseMove = (e) => {
      cursor.style.left = `${e.clientX}px`;
      cursor.style.top = `${e.clientY}px`;
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
    };
  }, []);
  
  return (
    <div className="pointer-events-none fixed inset-0 z-50">
      <div 
        ref={cursorRef}
        className="absolute rounded-full bg-white mix-blend-difference"
        style={{
          width: '16px',
          height: '16px',
          transform: 'translate(-50%, -50%)'
        }}
      />
    </div>
  );
};

const Home = () => {
  // Magical floating elements data
  const floatingElements = [
    {
      src: "https://storybook.emergent.sh/images/download1.png",
      alt: "Floating magic",
      size: "w-48 h-48",
      position: "top-[15%] left-[12%]",
      delay: 0
    },
    {
      src: "https://storybook.emergent.sh/images/download2.png",
      alt: "Floating magic",
      size: "w-36 h-36",
      position: "top-[10%] left-[45%]",
      delay: 0.5
    },
    {
      src: "https://storybook.emergent.sh/images/download3.jpg",
      alt: "Floating sparkles",
      size: "w-52 h-52",
      position: "top-[18%] right-[15%]",
      delay: 1
    },
    {
      src: "https://storybook.emergent.sh/images/download4.png",
      alt: "Floating elements",
      size: "w-32 h-32",
      position: "top-[45%] left-[5%]",
      delay: 1.5
    },
    {
      src: "https://storybook.emergent.sh/images/download5.png",
      alt: "Floating magic",
      size: "w-44 h-44",
      position: "top-[50%] right-[8%]",
      delay: 2
    },
    {
      src: "https://storybook.emergent.sh/images/download6.png",
      alt: "Floating elements",
      size: "w-32 h-32",
      position: "bottom-[10%] left-[18%]",
      delay: 2.5
    },
    {
      src: "https://storybook.emergent.sh/images/download7.png",
      alt: "Floating sparkles",
      size: "w-36 h-36",
      position: "bottom-[5%] left-[45%]",
      delay: 3
    },
    {
      src: "https://storybook.emergent.sh/images/download8.png",
      alt: "Floating magic",
      size: "w-36 h-36",
      position: "bottom-[12%] right-[14%]",
      delay: 3.5
    }
  ];

  return (
    <div className="landing-page-container relative overflow-hidden min-h-screen">
      {/* Fluid Simulation Background */}
      <FluidSimulation />
      
      {/* Floating Elements */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-[2]">
        {floatingElements.map((element, index) => (
          <FloatingElement 
            key={index}
            src={element.src}
            alt={element.alt}
            size={element.size}
            position={element.position}
            delay={element.delay}
          />
        ))}
      </div>
      
      {/* Custom Cursor */}
      <CustomCursor />
      
      {/* Main Content */}
      <div className="content-container relative z-20 flex flex-col items-center justify-center min-h-screen text-center px-6">
        <h1 className="headline text-6xl md:text-8xl font-bold text-white mb-8 tracking-tight">
          Create magic moments
        </h1>
        <p className="description text-xl md:text-2xl text-gray-200 mb-12 max-w-2xl leading-relaxed">
          Wonderful Illustrated stories all about your children
        </p>
        <a 
          className="cta-button bg-white text-black px-8 py-4 rounded-full text-lg font-semibold hover:bg-gray-100 transition-all duration-300 transform hover:scale-105"
          href="/app" 
          data-discover="true"
        >
          Start your adventure
        </a>
      </div>
    </div>
  );
};

const AppContent = () => {
  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-gray-800 mb-4">Welcome to Storybook!</h1>
        <p className="text-xl text-gray-600 mb-8">Your magical adventure begins here...</p>
        <a 
          href="/" 
          className="bg-black text-white px-6 py-3 rounded-full hover:bg-gray-800 transition-colors duration-300"
        >
          Back to Home
        </a>
      </div>
    </div>
  );
};

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/app" element={<AppContent />} />
        </Routes>
      </BrowserRouter>
    </div>
  );
}

export default App;