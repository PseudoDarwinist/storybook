import React, { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { FaSignOutAlt, FaRedo, FaPlus } from 'react-icons/fa';
import StoryBook from './StoryBook';
import './StoryDisplay.css';

const StoryDisplay = () => {
  const navigate = useNavigate();
  const location = useLocation();
  
  // Get story data from navigation state
  const { story, kidName, kidPhoto } = location.state || {};
  
  // Check if we have story data
  useEffect(() => {
    if (!story) {
      navigate('/create');
    }
  }, [story, navigate]);
  
  // Handle logout
  const handleLogout = () => {
    navigate('/');
  };
  
  // Handle create new story  
  const handleCreateNewStory = () => {
    navigate('/create');
  };
  
  // Handle generate new story (same data, new generation)
  const handleGenerateNewStory = () => {
    navigate('/story-generation', { state: { kidName, kidPhoto } });
  };
  
  if (!story) {
    return (
      <div className="story-display-loading">
        <p>Loading story...</p>
      </div>
    );
  }
  
  return (
    <div className="story-display-container">
      {/* Floating Controls */}
      <div className="story-controls">
        <button onClick={handleLogout} className="control-btn logout-btn" title="Logout">
          <FaSignOutAlt />
          <span>Logout</span>
        </button>
        <button onClick={handleGenerateNewStory} className="control-btn retry-btn" title="Generate New Story">
          <FaRedo />
          <span>New Version</span>
        </button>
        <button onClick={handleCreateNewStory} className="control-btn create-btn" title="Create Different Story">
          <FaPlus />
          <span>New Story</span>
        </button>
      </div>
      
      {/* Story Book Component */}
      <StoryBook 
        story={story.story || []}
        title={story.title || `${kidName}'s Adventure`}
        moral={story.moral}
        images={story.images || []}
        kidName={kidName}
        kidPhoto={kidPhoto}
      />
      
      {/* Instructions */}
      <div className="story-instructions">
        <p>Click the edges of the book to turn pages • Use the dots below to jump to any page</p>
      </div>
    </div>
  );
};

export default StoryDisplay;
