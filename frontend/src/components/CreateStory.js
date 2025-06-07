import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  FaCamera, FaUpload, FaChild, FaSignOutAlt, FaArrowRight, 
  FaArrowLeft, FaCheck, FaTree, FaRocket, FaCrown, FaMagic,
  FaBook, FaPencilAlt, FaFeather, FaBookOpen, FaEdit,
  FaWater, FaDragon, FaLightbulb, FaExclamationTriangle
} from 'react-icons/fa';

const CreateStory = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  
  // Form state
  const [currentStep, setCurrentStep] = useState(1);
  const [kidPhoto, setKidPhoto] = useState(null);
  const [kidPhotoPreview, setKidPhotoPreview] = useState(null);
  const [kidNames, setKidNames] = useState('');
  const [ageLevel, setAgeLevel] = useState('5-7 years');
  const [isDragging, setIsDragging] = useState(false);
  const [selectedTheme, setSelectedTheme] = useState(null);
  const [storyType, setStoryType] = useState('adventure');
  const [storyLength, setStoryLength] = useState('medium');
  const [specialIngredients, setSpecialIngredients] = useState('');
  
  // API state
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [apiBaseUrl, setApiBaseUrl] = useState('');

  // Get API base URL from environment
  useEffect(() => {
    // Default to localhost if not defined
    setApiBaseUrl(process.env.REACT_APP_API_URL || 'http://localhost:8000');
  }, []);
  
  // Handle file upload
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setKidPhoto(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setKidPhotoPreview(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };
  
  // Handle drag and drop
  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };
  
  const handleDragLeave = () => {
    setIsDragging(false);
  };
  
  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      setKidPhoto(file);
      
      const reader = new FileReader();
      reader.onloadend = () => {
        setKidPhotoPreview(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };
  
  // Handle next step
  const handleNextStep = () => {
    // Validate form based on current step
    if (currentStep === 1) {
      if (!kidNames.trim()) {
        setError("Please enter your kid's name");
        return;
      }
      if (!kidPhoto) {
        setError("Please upload a photo of your kid");
        return;
      }
      setError(null);
      setCurrentStep(2);
    } else if (currentStep === 2) {
      if (!selectedTheme) {
        setError("Please select a theme");
        return;
      }
      setError(null);
      setCurrentStep(3);
    }
  };
  
  // Handle back step
  const handleBackStep = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
      setError(null);
    }
  };
  
  // Handle theme selection
  const handleThemeSelect = (theme) => {
    setSelectedTheme(theme);
    setError(null);
  };
  
  // Handle story type selection
  const handleStoryTypeSelect = (type) => {
    setStoryType(type);
  };
  
  // Handle story length selection
  const handleStoryLengthSelect = (length) => {
    setStoryLength(length);
  };
  
  // Handle create story
  const handleCreateStory = async () => {
    // Validate form data
    if (!kidNames.trim()) {
      setError("Please enter your kid's name");
      return;
    }
    
    if (!kidPhoto) {
      setError("Please upload a photo of your kid");
      return;
    }
    
    if (!selectedTheme) {
      setError("Please select a theme");
      return;
    }
    
    try {
      setError(null);
      setIsGenerating(true);
      
      // Create form data
      const formData = new FormData();
      formData.append('kid_name', kidNames);
      formData.append('kid_photo', kidPhoto);
      formData.append('age_level', ageLevel);
      formData.append('theme', selectedTheme);
      formData.append('story_type', storyType);
      formData.append('story_length', storyLength);
      formData.append('special_ingredients', specialIngredients);
      
      // Make API call
      const response = await fetch(`${apiBaseUrl}/api/stories/generate`, {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to generate story');
      }
      
      const storyData = await response.json();
      
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
      setError(err.message || 'An error occurred while generating the story');
      setIsGenerating(false);
    }
  };
  
  // Show loading state
  const handleStartGeneration = () => {
    // Validate form data before proceeding
    if (!kidNames.trim()) {
      setError("Please enter your kid's name");
      return;
    }
    
    if (!kidPhoto) {
      setError("Please upload a photo of your kid");
      return;
    }
    
    if (!selectedTheme) {
      setError("Please select a theme");
      return;
    }
    
    // Set current step to 4 to show progress
    setCurrentStep(4);
    
    // Navigate to the generation page and pass all the form data
    navigate('/generation', { 
      state: { 
        kidNames,
        kidPhoto,
        kidPhotoPreview,
        ageLevel,
        selectedTheme,
        storyType,
        storyLength,
        specialIngredients
      } 
    });
  };
  
  // Handle logout
  const handleLogout = () => {
    // Implement logout logic here
    navigate('/');
  };

  // Theme data
  const themes = [
    {
      id: 'forest',
      name: 'Adventure in Forest',
      description: 'Explore magical forests and meet woodland creatures',
      color: 'bg-green-600',
      hoverColor: 'hover:bg-green-700',
      icon: <FaTree className="text-white text-3xl" />
    },
    {
      id: 'space',
      name: 'Space Exploration',
      description: 'Journey through stars, planets and beyond',
      color: 'bg-indigo-600',
      hoverColor: 'hover:bg-indigo-700',
      icon: <FaRocket className="text-white text-3xl" />
    },
    {
      id: 'ocean',
      name: 'Ocean Discovery',
      description: 'Dive deep into oceans full of wonder',
      color: 'bg-blue-600',
      hoverColor: 'hover:bg-blue-700',
      icon: <FaWater className="text-white text-3xl" />
    },
    {
      id: 'kingdom',
      name: 'Magical Kingdom',
      description: 'Enter a world of castles, dragons and magic',
      color: 'bg-orange-700',
      hoverColor: 'hover:bg-orange-800',
      icon: <FaCrown className="text-white text-3xl" />
    },
    {
      id: 'dinosaur',
      name: 'Dinosaur World',
      description: 'Adventure back in time with dinosaurs',
      color: 'bg-red-700',
      hoverColor: 'hover:bg-red-800',
      icon: <FaDragon className="text-white text-3xl" />
    },
    {
      id: 'custom',
      name: 'Custom Theme...',
      description: 'Create your own unique theme',
      color: 'bg-blue-600',
      hoverColor: 'hover:bg-blue-700',
      icon: <FaMagic className="text-white text-3xl" />
    }
  ];

  // Simplified step rendering helper function
  const renderStepIndicator = (stepNumber, title, subtitle) => {
    // Determine if step is active, completed, or inactive
    let isActive = currentStep === stepNumber;
    let isCompleted = currentStep > stepNumber;
    
    // Determine background color based on step status
    let bgColorClass = 'bg-gray-700'; // default inactive
    if (isActive) bgColorClass = 'bg-blue-500';
    if (isCompleted) bgColorClass = 'bg-green-500';
    
    // Determine text color based on step status
    let textColorClass = 'text-gray-400'; // default inactive
    if (isActive) textColorClass = 'text-blue-400';
    if (isCompleted) textColorClass = 'text-green-500';
    
    return (
      <div className="flex flex-col items-center">
        <div className={`w-10 h-10 rounded-full ${bgColorClass} flex items-center justify-center text-white font-semibold relative`}>
          {/* Show checkmark for completed steps, number for others */}
          {isCompleted ? (
            <FaCheck />
          ) : (
            stepNumber
          )}
          
          {/* Add animation for active step */}
          {isActive && (
            <>
              <span className="absolute w-full h-full rounded-full bg-blue-500 opacity-30 animate-ping"></span>
              <span className="absolute w-[120%] h-[120%] rounded-full bg-blue-400 opacity-20 animate-ping" style={{ animationDelay: '0.2s' }}></span>
              <span className="absolute w-[140%] h-[140%] rounded-full bg-blue-300 opacity-10 animate-ping" style={{ animationDelay: '0.4s' }}></span>
            </>
          )}
        </div>
        <div className="mt-2 text-center">
          <p className={`${textColorClass} font-medium`}>{title}</p>
          <p className="text-gray-500 text-xs">{subtitle}</p>
        </div>
      </div>
    );
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
        <div className="bg-gray-900 rounded-lg shadow-xl w-full max-w-3xl">
          {/* Progress Steps - Simplified */}
          <div className="flex justify-center py-8 px-4 border-b border-gray-800">
            <div className="flex items-center w-full max-w-2xl justify-between">
              {renderStepIndicator(1, "Kid Details", "Photos & Info")}
              {renderStepIndicator(2, "Theme", "Story Setting")}
              {renderStepIndicator(3, "Story Specs", "Customize")}
              {renderStepIndicator(4, "Creating Magic", "AI Generation")}
            </div>
          </div>
          
          {/* Error Message */}
          {error && (
            <div className="mx-8 mt-6 p-3 bg-red-900 bg-opacity-30 border border-red-500 rounded-lg flex items-center">
              <FaExclamationTriangle className="text-red-500 mr-2" />
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}
          
          {/* Form Content */}
          <div className="p-8">
            {/* Step 1: Kid Details */}
            {currentStep === 1 && (
              <>
                <h2 className="text-2xl text-center font-semibold text-blue-400 mb-2">
                  Tell Us About Your Little Hero!
                </h2>
                <p className="text-gray-400 text-center mb-8">
                  Upload photos and share their names to personalize the story
                </p>
                
                {/* Photo Upload */}
                <div className="mb-8 flex flex-col items-center">
                  <button 
                    className="flex items-center text-blue-400 mb-4"
                    onClick={() => fileInputRef.current.click()}
                  >
                    <FaUpload className="mr-2" /> Upload Kid's Photo
                  </button>
                  
                  <div 
                    className={`w-full max-w-md h-40 border-2 border-dashed rounded-lg flex flex-col items-center justify-center cursor-pointer
                      ${isDragging ? 'border-blue-500 bg-blue-500 bg-opacity-10' : 'border-gray-600'}
                      ${kidPhotoPreview ? 'p-2' : 'p-6'}`}
                    onClick={() => fileInputRef.current.click()}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                  >
                    {kidPhotoPreview ? (
                      <img 
                        src={kidPhotoPreview} 
                        alt="Kid's preview" 
                        className="max-h-full rounded" 
                      />
                    ) : (
                      <>
                        <FaCamera className="text-blue-400 text-3xl mb-2" />
                        <p className="text-gray-300 text-center">Drag & drop a photo here</p>
                        <p className="text-gray-500 text-sm">or click to browse files</p>
                      </>
                    )}
                  </div>
                  
                  <input 
                    type="file" 
                    ref={fileInputRef}
                    className="hidden"
                    accept="image/*"
                    onChange={handleFileChange}
                  />
                </div>
                
                {/* Kid's Name */}
                <div className="mb-8">
                  <label className="block mb-2">
                    <div className="flex items-center">
                      <FaChild className="text-blue-400 mr-2" />
                      <span className="text-gray-300">Kid's Name(s)</span>
                      <span className="text-red-500 ml-1">*</span>
                    </div>
                  </label>
                  <input 
                    type="text"
                    value={kidNames}
                    onChange={(e) => setKidNames(e.target.value)}
                    placeholder="Enter names (separated by commas for multiple kids)"
                    className="w-full bg-gray-800 border border-gray-700 rounded-md py-3 px-4 text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>
                
                {/* Age Level */}
                <div className="mb-12">
                  <label className="block mb-4">
                    <div className="flex items-center">
                      <span className="text-gray-300">Age Level</span>
                      <span className="text-red-500 ml-1">*</span>
                    </div>
                  </label>
                  
                  <div className="flex flex-wrap gap-3 justify-center">
                    <button 
                      className={`py-2 px-6 rounded-full ${ageLevel === '3-4 years' ? 'bg-blue-500 text-white' : 'bg-gray-800 text-gray-300'}`}
                      onClick={() => setAgeLevel('3-4 years')}
                    >
                      3-4 years
                    </button>
                    <button 
                      className={`py-2 px-6 rounded-full ${ageLevel === '5-7 years' ? 'bg-blue-500 text-white' : 'bg-gray-800 text-gray-300'}`}
                      onClick={() => setAgeLevel('5-7 years')}
                    >
                      5-7 years
                    </button>
                    <button 
                      className={`py-2 px-6 rounded-full ${ageLevel === '8-10 years' ? 'bg-blue-500 text-white' : 'bg-gray-800 text-gray-300'}`}
                      onClick={() => setAgeLevel('8-10 years')}
                    >
                      8-10 years
                    </button>
                    <button 
                      className={`py-2 px-6 rounded-full ${ageLevel === '11-12 years' ? 'bg-blue-500 text-white' : 'bg-gray-800 text-gray-300'}`}
                      onClick={() => setAgeLevel('11-12 years')}
                    >
                      11-12 years
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* Step 2: Theme Selection */}
            {currentStep === 2 && (
              <>
                <h2 className="text-2xl text-center font-semibold text-blue-400 mb-2">
                  Choose a Magical Theme
                </h2>
                <p className="text-gray-400 text-center mb-8">
                  Select the perfect backdrop for your story adventure
                </p>
                
                {/* Theme Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-12">
                  {themes.map((theme) => (
                    <div 
                      key={theme.id}
                      className={`${theme.color} ${theme.hoverColor} rounded-lg p-6 flex flex-col items-center justify-center cursor-pointer transition-all duration-200 transform hover:scale-105 ${selectedTheme === theme.id ? 'ring-4 ring-white' : ''}`}
                      onClick={() => handleThemeSelect(theme.id)}
                    >
                      <div className="mb-4">
                        {theme.icon}
                      </div>
                      <h3 className="text-white text-lg font-semibold mb-2 text-center">
                        {theme.name}
                      </h3>
                      <p className="text-white text-opacity-80 text-sm text-center">
                        {theme.description}
                      </p>
                    </div>
                  ))}
                </div>
              </>
            )}
            
            {/* Step 3: Story Specs */}
            {currentStep === 3 && (
              <>
                <h2 className="text-2xl text-center font-semibold text-blue-400 mb-2">
                  Customize Your Story
                </h2>
                <p className="text-gray-400 text-center mb-8">
                  Add special details to make your story unique
                </p>
                
                {/* Story Type */}
                <div className="mb-8">
                  <label className="block mb-4 flex items-center">
                    <FaBook className="text-blue-400 mr-2" />
                    <span className="text-gray-300">Story Type</span>
                    <span className="text-red-500 ml-1">*</span>
                  </label>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div 
                      className={`rounded-lg p-4 flex items-center cursor-pointer transition-all duration-200 ${storyType === 'adventure' ? 'bg-blue-900 border border-blue-500' : 'bg-gray-800 border border-gray-700'}`}
                      onClick={() => handleStoryTypeSelect('adventure')}
                    >
                      <div className="bg-blue-500 rounded-full p-3 mr-4">
                        <FaBook className="text-white text-xl" />
                      </div>
                      <div>
                        <h3 className="text-white text-lg font-semibold">Adventure</h3>
                        <p className="text-gray-400 text-sm">Exciting journeys and quests</p>
                      </div>
                    </div>
                    
                    <div 
                      className={`rounded-lg p-4 flex items-center cursor-pointer transition-all duration-200 ${storyType === 'educational' ? 'bg-blue-900 border border-blue-500' : 'bg-gray-800 border border-gray-700'}`}
                      onClick={() => handleStoryTypeSelect('educational')}
                    >
                      <div className="bg-gray-600 rounded-full p-3 mr-4">
                        <FaPencilAlt className="text-white text-xl" />
                      </div>
                      <div>
                        <h3 className="text-white text-lg font-semibold">Educational</h3>
                        <p className="text-gray-400 text-sm">Learning through stories</p>
                      </div>
                    </div>
                  </div>
                </div>
                
                {/* Story Length */}
                <div className="mb-8">
                  <label className="block mb-4 flex items-center">
                    <FaEdit className="text-blue-400 mr-2" />
                    <span className="text-gray-300">Story Length</span>
                  </label>
                  
                  <div className="flex justify-center space-x-8">
                    <div 
                      className={`flex flex-col items-center cursor-pointer transition-all duration-200 ${storyLength === 'short' ? 'text-blue-400' : 'text-gray-500'}`}
                      onClick={() => handleStoryLengthSelect('short')}
                    >
                      <div className={`rounded-full p-4 mb-2 ${storyLength === 'short' ? 'bg-blue-900' : 'bg-gray-800'}`}>
                        <FaFeather className="text-2xl" />
                      </div>
                      <span>Short</span>
                    </div>
                    
                    <div 
                      className={`flex flex-col items-center cursor-pointer transition-all duration-200 ${storyLength === 'medium' ? 'text-blue-400' : 'text-gray-500'}`}
                      onClick={() => handleStoryLengthSelect('medium')}
                    >
                      <div className={`rounded-full p-4 mb-2 ${storyLength === 'medium' ? 'bg-blue-900' : 'bg-gray-800'}`}>
                        <FaBook className="text-2xl" />
                      </div>
                      <span>Medium</span>
                    </div>
                    
                    <div 
                      className={`flex flex-col items-center cursor-pointer transition-all duration-200 ${storyLength === 'long' ? 'text-blue-400' : 'text-gray-500'}`}
                      onClick={() => handleStoryLengthSelect('long')}
                    >
                      <div className={`rounded-full p-4 mb-2 ${storyLength === 'long' ? 'bg-blue-900' : 'bg-gray-800'}`}>
                        <FaBookOpen className="text-2xl" />
                      </div>
                      <span>Long</span>
                    </div>
                  </div>
                </div>
                
                {/* Special Magic Ingredients */}
                <div className="mb-12">
                  <label className="block mb-4 flex items-center">
                    <FaLightbulb className="text-blue-400 mr-2" />
                    <span className="text-gray-300">Special Magic Ingredients</span>
                    <span className="text-gray-500 ml-2">(optional)</span>
                  </label>
                  
                  <div className="relative">
                    <textarea
                      value={specialIngredients}
                      onChange={(e) => setSpecialIngredients(e.target.value)}
                      placeholder="Add any special elements for the story... mentions of pets, hobbies, favorite characters..."
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg py-4 px-5 text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 h-32 resize-none"
                    ></textarea>
                    <FaMagic className="absolute bottom-4 right-4 text-yellow-500" />
                  </div>
                </div>
              </>
            )}
            
            {/* Navigation Buttons */}
            <div className="flex justify-center space-x-4">
              {currentStep > 1 && (
                <button 
                  className="bg-gray-700 hover:bg-gray-600 text-white px-6 py-3 rounded-full flex items-center font-medium"
                  onClick={handleBackStep}
                  disabled={isGenerating}
                >
                  <FaArrowLeft className="mr-2" /> Back
                </button>
              )}
              
              {currentStep < 3 ? (
                <button 
                  className="bg-blue-500 hover:bg-blue-600 text-white px-6 py-3 rounded-full flex items-center font-medium"
                  onClick={handleNextStep}
                >
                  Next Step <FaArrowRight className="ml-2" />
                </button>
              ) : (
                <button 
                  className={`bg-blue-500 hover:bg-blue-600 text-white px-6 py-3 rounded-full flex items-center font-medium ${isGenerating ? 'opacity-50 cursor-not-allowed' : ''}`}
                  onClick={handleStartGeneration}
                  disabled={isGenerating}
                >
                  {isGenerating ? (
                    <>
                      <span className="animate-pulse">Creating Story...</span>
                      <div className="ml-2 animate-spin h-5 w-5 border-2 border-white rounded-full border-t-transparent"></div>
                    </>
                  ) : (
                    <>
                      Create My Story <FaMagic className="ml-2" />
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CreateStory;
