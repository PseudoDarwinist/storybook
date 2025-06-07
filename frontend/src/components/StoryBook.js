import React, { useState, useEffect } from 'react';
import './StoryBook.css';

const StoryBook = ({ story, title, moral, images }) => {
  const [currentPage, setCurrentPage] = useState(0);
  const [isFlipping, setIsFlipping] = useState(false);
  const [direction, setDirection] = useState('');

  // Create pages by pairing story sentences with images
  const createPages = () => {
    if (!story || story.length === 0) return [];
    
    const pages = [];
    
    // Title page
    pages.push({
      type: 'title',
      content: title,
      subtitle: 'A personalized story',
      image: images && images[0] ? images[0] : null
    });

    // Story pages (2 sentences per page with image)
    for (let i = 0; i < story.length; i += 2) {
      const imageIndex = Math.floor(i / 2);
      pages.push({
        type: 'story',
        content: [story[i], story[i + 1]].filter(Boolean),
        image: images && images[imageIndex] ? images[imageIndex] : null,
        pageNumber: Math.floor(i / 2) + 2
      });
    }

    // Moral page
    if (moral) {
      pages.push({
        type: 'moral',
        content: moral,
        image: images && images[images.length - 1] ? images[images.length - 1] : null
      });
    }

    return pages;
  };

  const pages = createPages();
  const totalPages = pages.length;

  const nextPage = () => {
    if (currentPage < totalPages - 1 && !isFlipping) {
      setIsFlipping(true);
      setDirection('next');
      setTimeout(() => {
        setCurrentPage(currentPage + 1);
        setIsFlipping(false);
      }, 600);
    }
  };

  const prevPage = () => {
    if (currentPage > 0 && !isFlipping) {
      setIsFlipping(true);
      setDirection('prev');
      setTimeout(() => {
        setCurrentPage(currentPage - 1);
        setIsFlipping(false);
      }, 600);
    }
  };

  const goToPage = (pageIndex) => {
    if (pageIndex !== currentPage && !isFlipping) {
      setIsFlipping(true);
      setDirection(pageIndex > currentPage ? 'next' : 'prev');
      setTimeout(() => {
        setCurrentPage(pageIndex);
        setIsFlipping(false);
      }, 600);
    }
  };

  const renderPage = (page, index) => {
    if (!page) return null;

    return (
      <div className={`page ${page.type}-page`} key={index}>
        <div className="page-content">
          {page.type === 'title' && (
            <>
              <div className="story-title">
                <h1>{page.content}</h1>
                <p className="subtitle">{page.subtitle}</p>
              </div>
              {page.image && (
                <div className="page-image">
                  <img 
                    src={`data:image/png;base64,${page.image}`} 
                    alt="Story illustration"
                  />
                </div>
              )}
            </>
          )}
          
          {page.type === 'story' && (
            <>
              <div className="page-image">
                {page.image ? (
                  <img 
                    src={`data:image/png;base64,${page.image}`} 
                    alt="Story illustration"
                  />
                ) : (
                  <div className="placeholder-image">
                    <div className="image-placeholder">
                      <span>✨</span>
                      <p>No illustration available</p>
                    </div>
                  </div>
                )}
              </div>
              <div className="story-text">
                {page.content.map((sentence, idx) => (
                  <p key={idx} className="story-sentence">{sentence}</p>
                ))}
              </div>
              {page.pageNumber && (
                <div className="page-number">Page {page.pageNumber} of {totalPages}</div>
              )}
            </>
          )}
          
          {page.type === 'moral' && (
            <>
              <div className="moral-section">
                <h2>The Moral of the Story</h2>
                <p className="moral-text">{page.content}</p>
              </div>
              {page.image && (
                <div className="page-image">
                  <img 
                    src={`data:image/png;base64,${page.image}`} 
                    alt="Story illustration"
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  if (!pages || pages.length === 0) {
    return (
      <div className="storybook-container">
        <div className="no-story">
          <h2>No story available</h2>
          <p>Please generate a story first.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="storybook-container">
      <div className="book-wrapper">
        <div 
          className={`book ${isFlipping ? `flipping-${direction}` : ''}`}
          onClick={nextPage}
        >
          <div className="book-spine"></div>
          <div className="pages-container">
            {/* Current page */}
            <div className="current-page">
              {renderPage(pages[currentPage], currentPage)}
            </div>
            
            {/* Next page preview (for flip effect) */}
            {currentPage < totalPages - 1 && (
              <div className="next-page">
                {renderPage(pages[currentPage + 1], currentPage + 1)}
              </div>
            )}

            {/* Previous page (for flip-back animation) */}
            {currentPage > 0 && (
                <div className="previous-page-for-anim">
                    {renderPage(pages[currentPage - 1], currentPage - 1)}
                </div>
            )}
          </div>
        </div>
        
        {/* Navigation */}
        <div className="book-controls">
          <button 
            className="nav-btn prev-btn" 
            onClick={(e) => { e.stopPropagation(); prevPage(); }}
            disabled={currentPage === 0 || isFlipping}
          >
            ← Previous
          </button>
          
          <div className="page-indicator">
            {Array.from({ length: totalPages }, (_, index) => (
              <button
                key={index}
                className={`page-dot ${index === currentPage ? 'active' : ''}`}
                onClick={(e) => { e.stopPropagation(); goToPage(index); }}
                disabled={isFlipping}
              />
            ))}
          </div>
          
          <button 
            className="nav-btn next-btn" 
            onClick={(e) => { e.stopPropagation(); nextPage(); }}
            disabled={currentPage === totalPages - 1 || isFlipping}
          >
            Next →
          </button>
        </div>
        
        {/* Instructions */}
        <div className="book-instructions">
          <p>Click on the book to turn pages, or use the navigation buttons</p>
        </div>
      </div>
    </div>
  );
};

export default StoryBook; 