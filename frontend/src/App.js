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

const FluidCanvas = () => {
  const canvasRef = useRef(null);
  
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    
    let animationId;
    let time = 0;
    
    const animate = () => {
      time += 0.01;
      
      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Create multiple flowing gradients
      for (let i = 0; i < 3; i++) {
        const gradient = ctx.createRadialGradient(
          canvas.width / 2 + Math.sin(time + i) * 300,
          canvas.height / 2 + Math.cos(time * 0.8 + i) * 200,
          0,
          canvas.width / 2,
          canvas.height / 2,
          Math.max(canvas.width, canvas.height) / 1.5
        );
        
        // Purple/Pink/Blue flowing colors
        gradient.addColorStop(0, `rgba(168, 85, 247, ${0.15 + Math.sin(time + i) * 0.1})`);
        gradient.addColorStop(0.3, `rgba(236, 72, 153, ${0.1 + Math.cos(time * 1.2 + i) * 0.08})`);
        gradient.addColorStop(0.6, `rgba(59, 130, 246, ${0.08 + Math.sin(time * 0.7 + i) * 0.06})`);
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      
      animationId = requestAnimationFrame(animate);
    };
    
    animate();
    
    const handleResize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    
    window.addEventListener('resize', handleResize);
    
    return () => {
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
      window.removeEventListener('resize', handleResize);
    };
  }, []);
  
  return (
    <canvas 
      ref={canvasRef}
      id="fluid" 
      className="w-screen h-screen fixed top-0 left-0 z-0 pointer-events-none"
    />
  );
};

const InteractiveCursor = () => {
  const canvasRef = useRef(null);
  const cursorRef = useRef(null);
  const particlesRef = useRef([]);
  const mouseRef = useRef({ x: 0, y: 0 });
  
  useEffect(() => {
    const canvas = canvasRef.current;
    const cursor = cursorRef.current;
    if (!canvas || !cursor) return;
    
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    
    let animationId;
    
    // Particle system
    class Particle {
      constructor(x, y) {
        this.x = x;
        this.y = y;
        this.vx = (Math.random() - 0.5) * 4;
        this.vy = (Math.random() - 0.5) * 4;
        this.life = 1;
        this.decay = Math.random() * 0.02 + 0.01;
        this.size = Math.random() * 3 + 1;
        this.color = this.getRandomColor();
      }
      
      getRandomColor() {
        const colors = [
          'rgba(168, 85, 247', // Purple
          'rgba(236, 72, 153', // Pink
          'rgba(59, 130, 246',  // Blue
          'rgba(16, 185, 129', // Emerald
          'rgba(245, 158, 11', // Amber
          'rgba(239, 68, 68',  // Red
        ];
        return colors[Math.floor(Math.random() * colors.length)];
      }
      
      update() {
        this.x += this.vx;
        this.y += this.vy;
        this.life -= this.decay;
        this.vx *= 0.98;
        this.vy *= 0.98;
      }
      
      draw(ctx) {
        ctx.save();
        ctx.globalAlpha = this.life;
        
        // Create glowing effect
        const gradient = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.size * 2);
        gradient.addColorStop(0, this.color + ', 1)');
        gradient.addColorStop(0.5, this.color + ', 0.5)');
        gradient.addColorStop(1, this.color + ', 0)');
        
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size * 2, 0, Math.PI * 2);
        ctx.fill();
        
        // Inner bright core
        ctx.fillStyle = this.color + ', 1)';
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size * 0.3, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.restore();
      }
    }
    
    const handleMouseMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current.x = e.clientX - rect.left;
      mouseRef.current.y = e.clientY - rect.top;
      
      // Update cursor position
      cursor.style.left = `${e.clientX}px`;
      cursor.style.top = `${e.clientY}px`;
      
      // Add particles on mouse movement
      for (let i = 0; i < 3; i++) {
        particlesRef.current.push(new Particle(
          mouseRef.current.x + (Math.random() - 0.5) * 10,
          mouseRef.current.y + (Math.random() - 0.5) * 10
        ));
      }
      
      // Limit particle count
      if (particlesRef.current.length > 100) {
        particlesRef.current = particlesRef.current.slice(-100);
      }
    };
    
    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Update and draw particles
      particlesRef.current = particlesRef.current.filter(particle => {
        particle.update();
        particle.draw(ctx);
        return particle.life > 0;
      });
      
      animationId = requestAnimationFrame(animate);
    };
    
    const handleResize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('resize', handleResize);
    animate();
    
    return () => {
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
      document.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('resize', handleResize);
    };
  }, []);
  
  return (
    <>
      <canvas 
        ref={canvasRef}
        className="fixed inset-0 z-40 pointer-events-none"
      />
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
    </>
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
      {/* Background Canvas */}
      <canvas className="h-full w-full absolute inset-0 z-0" width="300" height="150"></canvas>
      
      {/* Fluid Canvas */}
      <FluidCanvas />
      
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
      
      {/* Interactive Cursor with Sparkles */}
      <InteractiveCursor />
      
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
      
      {/* Emergent Badge */}
      <a 
        id="emergent-badge" 
        target="_blank" 
        href="https://app.emergent.sh/?utm_source=emergent-badge"
        rel="noopener noreferrer"
        className="fixed bottom-5 right-5 flex items-center no-underline p-3 font-sans z-[9999] shadow-lg rounded-lg bg-white border border-gray-200 hover:shadow-xl transition-shadow duration-300"
      >
        <div className="flex flex-row items-center">
          <img 
            className="w-5 h-5 mr-2" 
            src="https://avatars.githubusercontent.com/in/1201222?s=120&u=2686cf91179bbafbc7a71bfbc43004cf9ae1acea&v=4" 
            alt="Emergent logo"
          />
          <p className="text-black text-sm font-medium m-0">Made with Emergent</p>
        </div>
      </a>
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