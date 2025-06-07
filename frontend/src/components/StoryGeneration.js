import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import StoryBook from './StoryBook';
import { FaSignOutAlt, FaRedo } from 'react-icons/fa';

const StoryGeneration = () => {
  const navigate = useNavigate();
  const location = useLocation();
  
  // Get story data from navigation state
  const {
    kidNames,
    kidPhoto,
    kidPhotoPreview,
    ageLevel,
    selectedTheme,
    storyType,
    storyLength,
    specialIngredients
  } = location.state || {};
  
  // API state
  const [isGenerating, setIsGenerating] = useState(true);
  const [generationError, setGenerationError] = useState(null);
  const [generatedStory, setGeneratedStory] = useState(null);
  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [retryCount, setRetryCount] = useState(0);
  
  // State for loading stages
  const [loadingStage, setLoadingStage] = useState(0);
  const loadingStages = [
    { message: "Analyzing photo...", subMessage: "Our AI is getting to know your child! ✨" },
    { message: "Creating a personalized story", subMessage: `Making ${kidNames} the star of the adventure!` },
    { message: "Generating magical illustrations...", subMessage: "Bringing the story to life with vibrant images" },
    { message: "Finalizing your storybook", subMessage: "Almost ready for your enjoyment!" }
  ];
  
  // State for countdown timer
  const [timeRemaining, setTimeRemaining] = useState(2 * 60); // 2 minutes in seconds
  
  // Get API base URL from environment
  useEffect(() => {
    // Default to localhost if not defined
    const url = process.env.REACT_APP_API_URL || 'http://localhost:8000';
    setApiBaseUrl(url);
    console.log("API Base URL set to:", url);
  }, []);
  
  // Generate story when component mounts
  useEffect(() => {
    if (!kidNames || !kidPhoto) {
      // If no data is provided, navigate back to create story
      navigate('/create');
      return;
    }
    
    // Only generate story if apiBaseUrl is set (avoid race condition)
    if (apiBaseUrl) {
      generateStory();
    }
  }, [retryCount, apiBaseUrl]); // Re-run when retry count changes OR when apiBaseUrl is set
  
  // Handle stage progression based on API progress
  useEffect(() => {
    if (generationError || generatedStory) return;
    
    const stageTimings = [8000, 30000, 20000, 10000]; // Estimated time for each stage
    
    const stageTimer = setTimeout(() => {
      if (loadingStage < loadingStages.length - 1) {
        setLoadingStage(loadingStage + 1);
      }
    }, stageTimings[loadingStage]);
    
    return () => clearTimeout(stageTimer);
  }, [loadingStage, generationError, generatedStory]);
  
  // Handle countdown timer
  useEffect(() => {
    if (timeRemaining <= 0 || generationError || generatedStory) return;
    
    const countdownTimer = setInterval(() => {
      setTimeRemaining(prev => prev - 1);
    }, 1000);
    
    return () => clearInterval(countdownTimer);
  }, [timeRemaining, generationError, generatedStory]);
  
  // Format time as MM:SS
  const formatTime = (seconds) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  };
  
  // Generate story
  const generateStory = async () => {
    try {
      setIsGenerating(true);
      setGenerationError(null);
      setLoadingStage(0);
      
      // Create form data
      const formData = new FormData();
      formData.append('kid_name', kidNames);
      formData.append('kid_photo', kidPhoto);
      formData.append('age_level', ageLevel);
      formData.append('theme', selectedTheme);
      formData.append('story_type', storyType);
      formData.append('story_length', storyLength);
      formData.append('special_ingredients', specialIngredients || '');
      
      // Debug logging
      console.log("Using API Base URL:", apiBaseUrl);
      console.log("API Base URL type:", typeof apiBaseUrl, "Length:", apiBaseUrl.length);
      const fullUrl = `${apiBaseUrl}/api/stories/generate`;
      console.log("Making API request to:", fullUrl);
      console.log("Full URL constructed:", fullUrl);
      
      // Make API call
      const response = await fetch(fullUrl, {
        method: 'POST',
        body: formData,
      });
      
      console.log("API Response Status:", response.status, response.statusText);
      console.log("API Response Headers:", Object.fromEntries(response.headers.entries()));
      
      if (!response.ok) {
        // Try to get error details
        let errorDetail = 'Failed to generate story';
        try {
          const errorData = await response.json();
          console.log("API Error Response:", errorData);
          errorDetail = errorData.detail || JSON.stringify(errorData) || errorDetail;
          
          // Check for quota exceeded errors
          if (typeof errorDetail === 'string' && 
              (errorDetail.toLowerCase().includes('quota') || 
               errorDetail.toLowerCase().includes('rate limit') ||
               response.status === 429)) {
            errorDetail = `API Quota Exceeded: ${errorDetail}. Please check your Gemini API key or try again later.`;
          }
        } catch (jsonError) {
          // If response is not JSON, try to get text
          try {
            const errorText = await response.text();
            console.error("Non-JSON error response:", errorText);
            // Check if it's HTML (likely a 404 page)
            if (errorText.includes('<!DOCTYPE') || errorText.includes('<html')) {
              errorDetail = `API Endpoint Not Found (404): The backend server might not be running properly or the endpoint doesn't exist. Status: ${response.status}`;
              console.error("Received HTML response instead of JSON. This suggests the API endpoint doesn't exist.");
            } else {
              errorDetail = `Server Error (${response.status}): ${errorText.substring(0, 200)}`;
            }
          } catch (textError) {
            console.error("Failed to read error response:", textError);
            errorDetail = `HTTP ${response.status}: Unable to read error details. ${response.statusText}`;
          }
        }
        throw new Error(errorDetail);
      }
      
      // Try to parse the JSON response
      let storyData;
      try {
        storyData = await response.json();
        console.log("Successfully received story data:", storyData);
      } catch (jsonError) {
        console.error("Failed to parse JSON response:", jsonError);
        throw new Error("Failed to parse story data from server");
      }
      
      setGeneratedStory(storyData);
      
      // Navigate to the story display page with the generated story data
      navigate('/story-display', { 
        state: { 
          story: storyData,
          kidName: kidNames,
          kidPhoto: kidPhotoPreview
        } 
      });
      
    } catch (err) {
      console.error('Error generating story:', err);
      setGenerationError(err.message || 'An error occurred while generating the story');
      setIsGenerating(false);
    }
  };
  
  // Handle retry
  const handleRetry = () => {
    setRetryCount(prev => prev + 1);
  };
  
  // Handle logout
  const handleLogout = () => {
    navigate('/');
  };
  
  // Handle cancel
  const handleCancel = () => {
    navigate('/create');
  };
  
  return (
    <div className="min-h-screen bg-black bg-opacity-95 flex flex-col">
      {/* Header */}
      <header className="bg-black bg-opacity-80 py-4 px-6 flex justify-between items-center border-b border-gray-800">
        <div className="flex items-center">
          <h1 className="text-white text-xl font-bold">Magic moments</h1>
          <p className="text-gray-400 text-xs ml-2">Create beautiful personalized stories for children</p>
        </div>
        
        <div className="flex items-center space-x-4">
          <button className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium">
            Create Story
          </button>
          <button className="text-white hover:text-blue-400 text-sm">
            Saved Stories
          </button>
          <span className="text-gray-400 text-sm">
            Welcome, heychetansingh@gmail.com
          </span>
          <button 
            className="text-gray-400 hover:text-white flex items-center text-sm"
            onClick={handleLogout}
          >
            <FaSignOutAlt className="mr-1" /> Logout
          </button>
        </div>
      </header>
      
      {/* Main Content */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="bg-gray-900 rounded-lg shadow-xl w-full max-w-2xl p-8">
          <h2 className="text-2xl text-center font-semibold text-blue-400 mb-8">
            Creating Your Magical Story for {kidNames}
          </h2>
          
          {generationError ? (
            // Error state
            <div className="text-center">
              <div className="bg-red-900 bg-opacity-30 rounded-lg p-6 mb-8">
                <h3 className="text-red-400 text-xl mb-4">Oops! Something went wrong</h3>
                <p className="text-gray-300 mb-4">{generationError}</p>
                <button 
                  onClick={handleRetry}
                  className="bg-blue-500 hover:bg-blue-600 text-white px-6 py-3 rounded-full flex items-center font-medium mx-auto"
                >
                  <FaRedo className="mr-2" /> Try Again
                </button>
              </div>
              <button 
                onClick={handleCancel}
                className="text-gray-400 hover:text-white underline"
              >
                Back to Story Creator
              </button>
            </div>
          ) : (
            <>
              {/* Rotating Arcs Animation */}
              <div className="relative flex justify-center items-center h-64 mb-8">
                {/* Colorful floating dots */}
                <div className="absolute w-4 h-4 rounded-full bg-yellow-400 animate-bounce-subtle" 
                     style={{ top: '10%', left: '50%', animationDuration: '6s', animationDelay: '0s' }}></div>
                <div className="absolute w-3 h-3 rounded-full bg-pink-500 animate-bounce-subtle" 
                     style={{ top: '40%', left: '20%', animationDuration: '7s', animationDelay: '0.5s' }}></div>
                <div className="absolute w-3 h-3 rounded-full bg-green-400 animate-bounce-subtle" 
                     style={{ top: '20%', right: '20%', animationDuration: '8s', animationDelay: '1s' }}></div>
                <div className="absolute w-4 h-4 rounded-full bg-purple-500 animate-bounce-subtle" 
                     style={{ bottom: '30%', right: '30%', animationDuration: '9s', animationDelay: '1.5s' }}></div>
                
                {/* Outer rotating arc */}
                <div className="absolute w-40 h-40 rounded-full animate-spin-slow">
                  <svg width="160" height="160" viewBox="0 0 160 160">
                    <circle 
                      cx="80" 
                      cy="80" 
                      r="70" 
                      fill="none" 
                      stroke="#3B82F6" 
                      strokeWidth="2" 
                      strokeDasharray="330 110" 
                      strokeLinecap="round"
                    />
                  </svg>
                </div>
                
                {/* Inner rotating arc */}
                <div className="absolute w-24 h-24 rounded-full animate-reverse-spin">
                  <svg width="96" height="96" viewBox="0 0 96 96">
                    <circle 
                      cx="48" 
                      cy="48" 
                      r="40" 
                      fill="none" 
                      stroke="#60A5FA" 
                      strokeWidth="2" 
                      strokeDasharray="188 64" 
                      strokeLinecap="round"
                    />
                  </svg>
                  
                  {/* Center blue dot */}
                  <div className="absolute w-6 h-6 bg-blue-500 rounded-full" 
                       style={{ top: 'calc(50% - 12px)', left: 'calc(50% - 12px)' }}></div>
                </div>
              </div>
              
              {/* Loading Messages */}
              <div className="bg-gray-950 rounded-lg p-6 mb-6">
                <p className="text-blue-400 text-center font-medium mb-2">
                  {loadingStages[loadingStage].message}
                </p>
                
                {loadingStages[loadingStage].subMessage && (
                  <p className="text-gray-300 text-center text-sm">
                    {loadingStages[loadingStage].subMessage}
                  </p>
                )}
                
                {/* Progress bar */}
                <div className="w-full bg-gray-800 rounded-full h-2.5 mt-4">
                  <div 
                    className="bg-blue-500 h-2.5 rounded-full transition-all duration-500 ease-in-out" 
                    style={{ width: `${(loadingStage + 1) / loadingStages.length * 100}%` }}
                  ></div>
                </div>
              </div>
              
              {/* Countdown Timer */}
              <div className="text-center mb-4">
                <p className="text-gray-400 mb-2">Estimated time remaining:</p>
                <p className="text-white text-2xl font-mono">{formatTime(timeRemaining)}</p>
              </div>
              
              {/* Progress Message */}
              <p className="text-gray-500 text-center text-sm italic">
                {loadingStage === 3 ? "Finalizing your magical story..." : ""}
              </p>
              
              {/* Cancel button */}
              <div className="text-center mt-8">
                <button 
                  onClick={handleCancel}
                  className="text-gray-400 hover:text-white underline text-sm"
                >
                  Cancel and return to Story Creator
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      
      {/* Footer */}
      <footer className="bg-gray-900 py-4 text-center text-gray-500 text-sm border-t border-gray-800">
        © 2025 Kids' Storybook Creator | Create personalized stories for your children
      </footer>
      
      {/* CSS for animations */}
      <style>{`
        @keyframes spin-slow {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        
        @keyframes reverse-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(-360deg); }
        }
        
        @keyframes bounce-subtle {
          0%, 100% { transform: translate(0, 0); }
          25% { transform: translate(5px, -5px); }
          50% { transform: translate(0, -8px); }
          75% { transform: translate(-5px, -3px); }
        }
        
        .animate-spin-slow {
          animation: spin-slow 8s linear infinite;
        }
        
        .animate-reverse-spin {
          animation: reverse-spin 6s linear infinite;
        }
        
        .animate-bounce-subtle {
          animation: bounce-subtle 4s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
};

export default StoryGeneration;