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
  const fluidSimRef = useRef(null);
  const pointersRef = useRef([]);
  const [webglSupported, setWebglSupported] = useState(true);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Check WebGL support
    const testCanvas = document.createElement('canvas');
    const gl = testCanvas.getContext('webgl') || testCanvas.getContext('experimental-webgl');
    if (!gl) {
      console.warn('WebGL not supported, using fallback CSS animation');
      setWebglSupported(false);
      return;
    }

    // Resize canvas to full screen
    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      if (fluidSimRef.current && fluidSimRef.current.resize) {
        fluidSimRef.current.resize();
      }
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Load and initialize fluid simulation
    const initializeFluidSimulation = () => {
      try {
        if (window.FluidSimulation && canvas && !isInitialized) {
          fluidSimRef.current = new window.FluidSimulation(canvas);
          
          // Initialize pointer
          const pointer = {
            id: -1,
            texcoordX: 0,
            texcoordY: 0,
            prevTexcoordX: 0,
            prevTexcoordY: 0,
            deltaX: 0,
            deltaY: 0,
            down: false,
            moved: false,
            color: { r: 0, g: 0, b: 0 }
          };
          pointersRef.current = [pointer];
          
          if (fluidSimRef.current) {
            fluidSimRef.current.pointers = pointersRef.current;
            
            // Initialize splatStack if not exists
            if (!fluidSimRef.current.splatStack) {
              fluidSimRef.current.splatStack = [];
            }

            // Add some initial splats for ambient motion
            setTimeout(() => {
              if (fluidSimRef.current && fluidSimRef.current.splatStack) {
                fluidSimRef.current.splatStack.push(3);
              }
            }, 1000);
            
            setIsInitialized(true);
          }
        }
      } catch (error) {
        console.error('Error initializing fluid simulation:', error);
        setWebglSupported(false);
      }
    };

    // Check if FluidSimulation class is already available
    if (window.FluidSimulation) {
      initializeFluidSimulation();
    } else {
      // Load fluid simulation script only once globally
      if (!window.fluidScriptLoaded && !window.fluidScriptLoading) {
        window.fluidScriptLoading = true;
        const script = document.createElement('script');
        script.src = '/fluid.js';
        script.onload = () => {
          window.fluidScriptLoaded = true;
          window.fluidScriptLoading = false;
          initializeFluidSimulation();
        };
        script.onerror = () => {
          console.error('Failed to load fluid simulation');
          window.fluidScriptLoading = false;
          setWebglSupported(false);
        };
        document.head.appendChild(script);
      } else if (window.fluidScriptLoaded) {
        initializeFluidSimulation();
      } else {
        // Script is loading, wait for it
        const checkForFluidSimulation = () => {
          if (window.FluidSimulation) {
            initializeFluidSimulation();
          } else if (!window.fluidScriptLoading) {
            setWebglSupported(false);
          } else {
            setTimeout(checkForFluidSimulation, 100);
          }
        };
        setTimeout(checkForFluidSimulation, 100);
      }
    }

    // Mouse event handlers
    const handleMouseMove = (e) => {
      if (!fluidSimRef.current) return;
      
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      const pointer = pointersRef.current[0];
      if (!pointer.down) {
        fluidSimRef.current.updatePointerDownData(pointer, -1, x, y);
      }
      fluidSimRef.current.updatePointerMoveData(pointer, x, y);
    };

    const handleMouseDown = (e) => {
      if (!fluidSimRef.current) return;
      
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      const pointer = pointersRef.current[0];
      fluidSimRef.current.updatePointerDownData(pointer, -1, x, y);
    };

    const handleMouseUp = () => {
      if (!fluidSimRef.current) return;
      
      const pointer = pointersRef.current[0];
      fluidSimRef.current.updatePointerUpData(pointer);
    };

    // Touch event handlers
    const handleTouchStart = (e) => {
      e.preventDefault();
      if (!fluidSimRef.current) return;
      
      const rect = canvas.getBoundingClientRect();
      const touch = e.touches[0];
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;
      
      const pointer = pointersRef.current[0];
      fluidSimRef.current.updatePointerDownData(pointer, touch.identifier, x, y);
    };

    const handleTouchMove = (e) => {
      e.preventDefault();
      if (!fluidSimRef.current) return;
      
      const rect = canvas.getBoundingClientRect();
      const touch = e.touches[0];
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;
      
      const pointer = pointersRef.current[0];
      fluidSimRef.current.updatePointerMoveData(pointer, x, y);
    };

    const handleTouchEnd = (e) => {
      e.preventDefault();
      if (!fluidSimRef.current) return;
      
      const pointer = pointersRef.current[0];
      fluidSimRef.current.updatePointerUpData(pointer);
    };

    // Add event listeners
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvas.addEventListener('touchend', handleTouchEnd, { passive: false });

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('touchstart', handleTouchStart);
      canvas.removeEventListener('touchmove', handleTouchMove);
      canvas.removeEventListener('touchend', handleTouchEnd);
      
      // Clean up script only if we added it
      if (!window.FluidSimulation) {
        const scripts = document.querySelectorAll('script[src="/fluid.js"]');
        scripts.forEach(script => script.remove());
      }
    };
  }, []);

  // Fallback CSS animation if WebGL not supported
  if (!webglSupported) {
    return (
      <div 
        className="fixed inset-0 z-0 w-full h-full fallback-fluid-bg"
        style={{ 
          background: `
            radial-gradient(ellipse at 20% 50%, rgba(6, 78, 59, 0.8) 0%, transparent 50%),
            radial-gradient(ellipse at 80% 20%, rgba(16, 185, 129, 0.6) 0%, transparent 50%),
            radial-gradient(ellipse at 40% 80%, rgba(5, 46, 22, 0.7) 0%, transparent 50%),
            linear-gradient(135deg, #064e3b 0%, #052e16 50%, #000000 100%)
          `,
          backgroundSize: '100% 100%, 100% 100%, 100% 100%, 100% 100%',
          animation: 'fluidFallback 8s ease-in-out infinite'
        }}
      />
    );
  }

  return (
    <canvas 
      ref={canvasRef}
      className="fixed inset-0 z-0 w-full h-full"
      style={{ 
        background: 'linear-gradient(135deg, #064e3b 0%, #052e16 50%, #000000 100%)',
        touchAction: 'none'
      }}
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