#!/usr/bin/env python3
"""
Test script to verify Gemini API connectivity.
This script tests if the Gemini API key is working correctly.
"""

import os
import sys
from pathlib import Path
from dotenv import load_dotenv
import google.generativeai as genai

# Add proper error handling for imports
try:
    from google.generativeai import types
except ImportError:
    print("Error: Required packages not found. Please install with:")
    print("pip install google-generativeai python-dotenv")
    sys.exit(1)

def load_environment():
    """Load environment variables from .env file."""
    # Get the directory of this script
    script_dir = Path(__file__).parent
    
    # Load .env file from the same directory
    env_path = script_dir / '.env'
    if not env_path.exists():
        print(f"Error: .env file not found at {env_path}")
        return False
    
    load_dotenv(env_path)
    
    # Check if API key is set
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("Error: GEMINI_API_KEY environment variable is not set in .env file")
        return False
    
    # Mask the API key for logging
    masked_key = api_key[:4] + "..." + api_key[-4:] if len(api_key) > 8 else "***"
    print(f"Found API key: {masked_key}")
    
    return api_key

def test_gemini_connectivity(api_key):
    """Test connectivity to Gemini API."""
    try:
        print("Configuring Gemini API...")
        genai.configure(api_key=api_key)
        
        print("Creating Gemini model...")
        model = genai.GenerativeModel("gemini-1.5-pro")
        
        print("Sending test request to Gemini API...")
        response = model.generate_content("Hello, please respond with a simple 'Yes, I am working!' if you receive this message.")
        
        if response and response.text:
            print("\n=== SUCCESS ===")
            print(f"Gemini API is working correctly!")
            print(f"Response: {response.text.strip()}")
            return True
        else:
            print("\n=== ERROR ===")
            print("Received empty response from Gemini API")
            return False
            
    except Exception as e:
        print("\n=== ERROR ===")
        print(f"Failed to connect to Gemini API: {str(e)}")
        
        # Provide more detailed error information based on common issues
        if "invalid api key" in str(e).lower():
            print("\nPossible causes:")
            print("- The API key may be incorrect")
            print("- The API key may have expired or been revoked")
            print("- The API key may not have access to the Gemini API")
        elif "network" in str(e).lower() or "connection" in str(e).lower():
            print("\nPossible causes:")
            print("- Network connectivity issues")
            print("- Firewall or proxy blocking access to Gemini API")
            print("- DNS resolution problems")
        elif "quota" in str(e).lower():
            print("\nPossible causes:")
            print("- API quota exceeded")
            print("- Rate limiting applied to your API key")
        
        return False

def main():
    """Main function to test Gemini API connectivity."""
    print("=== Gemini API Connectivity Test ===\n")
    
    # Load environment variables
    api_key = load_environment()
    if not api_key:
        return
    
    # Test connectivity
    success = test_gemini_connectivity(api_key)
    
    # Print final result
    print("\n=== Test Result ===")
    if success:
        print("✅ Gemini API connection successful")
    else:
        print("❌ Gemini API connection failed")
        print("\nTroubleshooting steps:")
        print("1. Verify your API key is correct")
        print("2. Check your internet connection")
        print("3. Ensure you have access to the Gemini API")
        print("4. Try using the API key in the Google AI Studio to verify it works")

if __name__ == "__main__":
    main()
