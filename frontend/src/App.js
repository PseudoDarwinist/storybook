import { useEffect, useRef, useState } from "react";
import "./App.css";
import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import CreateStory from "./components/CreateStory";
import StoryGeneration from "./components/StoryGeneration";
import StoryDisplay from "./components/StoryDisplay";

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
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Check WebGL support with more detailed error handling
    const testCanvas = document.createElement('canvas');
    let gl;
    
    try {
      gl = testCanvas.getContext('webgl2') || 
           testCanvas.getContext('webgl') || 
           testCanvas.getContext('experimental-webgl');
    } catch (e) {
      console.error('WebGL initialization error:', e);
      setWebglSupported(false);
      return;
    }
    
    if (!gl) {
      console.warn('WebGL not supported, using fallback CSS animation');
      setWebglSupported(false);
      return;
    }

    // Resize canvas to full screen
    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      
      // If fluid simulation is already initialized, update its dimensions
      if (fluidSimRef.current && typeof fluidSimRef.current.resize === 'function') {
        try {
          fluidSimRef.current.resize();
        } catch (e) {
          console.warn('Error resizing fluid simulation:', e);
        }
      }
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Check if script already loaded
    if (window.FluidSimulation) {
      initializeFluidSimulation();
    } else {
      // Load proper fluid simulation script
      const existingScript = document.querySelector('script[src="/proper-fluid.js"]');
      if (!existingScript) {
        const script = document.createElement('script');
        script.src = '/proper-fluid.js';
        script.onload = initializeFluidSimulation;
        script.onerror = (e) => {
          console.error('Failed to load proper fluid simulation:', e);
          
          // Try loading the original fluid.js as fallback
          console.log('Attempting to load original fluid.js as fallback');
          const fallbackScript = document.createElement('script');
          fallbackScript.src = '/fluid.js';
          fallbackScript.onload = initializeFluidSimulation;
          fallbackScript.onerror = () => {
            console.error('Failed to load fallback fluid simulation');
            setWebglSupported(false);
            setLoadError(true);
          };
          document.head.appendChild(fallbackScript);
        };
        document.head.appendChild(script);
      } else {
        // Script exists but might still be loading
        existingScript.onload = initializeFluidSimulation;
      }
    }

    function initializeFluidSimulation() {
      try {
        if (window.FluidSimulation && canvas) {
          // Only create new instance if one doesn't exist
          if (!fluidSimRef.current) {
            fluidSimRef.current = new window.FluidSimulation(canvas);
          
            // Initialize pointer with enhanced properties
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
              color: { r: 0.7, g: 0.4, b: 0.9 } // Start with vibrant purple
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
                  fluidSimRef.current.splatStack.push(5); // Increased from 3 for more initial activity
                }
              }, 500); // Reduced from 1000 to start animation sooner
            }
          }
        }
      } catch (error) {
        console.error('Error initializing fluid simulation:', error);
        setWebglSupported(false);
        setLoadError(true);
      }
    }

    // Mouse event handlers with improved error handling
    const handleMouseMove = (e) => {
      if (!fluidSimRef.current) return;
      
      try {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        const pointer = pointersRef.current[0];
        if (!pointer.down) {
          fluidSimRef.current.updatePointerDownData(pointer, -1, x, y);
        }
        fluidSimRef.current.updatePointerMoveData(pointer, x, y);
      } catch (error) {
        console.warn('Error handling mouse move:', error);
      }
    };

    const handleMouseDown = (e) => {
      if (!fluidSimRef.current) return;
      
      try {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        const pointer = pointersRef.current[0];
        fluidSimRef.current.updatePointerDownData(pointer, -1, x, y);
      } catch (error) {
        console.warn('Error handling mouse down:', error);
      }
    };

    const handleMouseUp = () => {
      if (!fluidSimRef.current) return;
      
      try {
        const pointer = pointersRef.current[0];
        fluidSimRef.current.updatePointerUpData(pointer);
      } catch (error) {
        console.warn('Error handling mouse up:', error);
      }
    };

    // Touch event handlers with improved error handling
    const handleTouchStart = (e) => {
      e.preventDefault();
      if (!fluidSimRef.current) return;
      
      try {
        const rect = canvas.getBoundingClientRect();
        const touch = e.touches[0];
        const x = touch.clientX - rect.left;
        const y = touch.clientY - rect.top;
        
        const pointer = pointersRef.current[0];
        fluidSimRef.current.updatePointerDownData(pointer, touch.identifier, x, y);
      } catch (error) {
        console.warn('Error handling touch start:', error);
      }
    };

    const handleTouchMove = (e) => {
      e.preventDefault();
      if (!fluidSimRef.current) return;
      
      try {
        const rect = canvas.getBoundingClientRect();
        const touch = e.touches[0];
        const x = touch.clientX - rect.left;
        const y = touch.clientY - rect.top;
        
        const pointer = pointersRef.current[0];
        fluidSimRef.current.updatePointerMoveData(pointer, x, y);
      } catch (error) {
        console.warn('Error handling touch move:', error);
      }
    };

    const handleTouchEnd = (e) => {
      e.preventDefault();
      if (!fluidSimRef.current) return;
      
      try {
        const pointer = pointersRef.current[0];
        fluidSimRef.current.updatePointerUpData(pointer);
      } catch (error) {
        console.warn('Error handling touch end:', error);
      }
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
        const scripts = document.querySelectorAll('script[src="/proper-fluid.js"], script[src="/fluid.js"]');
        scripts.forEach(script => script.remove());
      }
    };
  }, []);

  // Enhanced fallback CSS animation if WebGL not supported
  if (!webglSupported) {
    return (
      <div 
        className="fixed inset-0 z-0 w-full h-full fallback-fluid-bg"
        style={{ 
          background: loadError ? 
            // More dynamic fallback if script loading failed
            `
              radial-gradient(ellipse at 25% 40%, rgba(6, 78, 59, 0.9) 0%, transparent 60%),
              radial-gradient(ellipse at 75% 25%, rgba(16, 185, 129, 0.7) 0%, transparent 60%),
              radial-gradient(ellipse at 45% 75%, rgba(5, 46, 22, 0.8) 0%, transparent 60%),
              radial-gradient(ellipse at 80% 80%, rgba(6, 95, 70, 0.7) 0%, transparent 60%),
              linear-gradient(135deg, #064e3b 0%, #065f46 35%, #047857 65%, #064e3b 100%)
            ` :
            // Standard fallback
            `
              radial-gradient(ellipse at 20% 50%, rgba(6, 78, 59, 0.8) 0%, transparent 50%),
              radial-gradient(ellipse at 80% 20%, rgba(16, 185, 129, 0.6) 0%, transparent 50%),
              radial-gradient(ellipse at 40% 80%, rgba(5, 46, 22, 0.7) 0%, transparent 50%),
              linear-gradient(135deg, #064e3b 0%, #052e16 50%, #000000 100%)
            `,
          backgroundSize: '200% 200%, 200% 200%, 200% 200%, 200% 200%',
          animation: loadError ? 
            'fluidFallbackEnhanced 12s ease-in-out infinite alternate' : 
            'fluidFallback 8s ease-in-out infinite'
        }}
      >
        {/* Add animated particles for more visual interest when WebGL fails */}
        {loadError && Array.from({ length: 20 }).map((_, i) => (
          <div 
            key={i}
            className="absolute rounded-full bg-white opacity-30"
            style={{
              width: `${Math.random() * 10 + 5}px`,
              height: `${Math.random() * 10 + 5}px`,
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animation: `floatParticle ${Math.random() * 10 + 15}s linear infinite`,
              animationDelay: `${Math.random() * 5}s`
            }}
          />
        ))}
      </div>
    );
  }

  return (
    <canvas 
      ref={canvasRef}
      className="fixed inset-0 z-0 w-full h-full"
      style={{ 
        background: 'linear-gradient(135deg, #01190f 0%, #021a14 50%, #011a14 100%)',
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
        <Link 
          className="cta-button bg-white text-black px-8 py-4 rounded-full text-lg font-semibold hover:bg-gray-100 transition-all duration-300 transform hover:scale-105"
          to="/app" 
          data-discover="true"
        >
          Start your adventure
        </Link>
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
          <Route path="/app" element={<CreateStory />} />
          <Route path="/generation" element={<StoryGeneration />} />
          <Route path="/story-display" element={<StoryDisplay />} />
        </Routes>
      </BrowserRouter>
    </div>
  );
}

export default App;
