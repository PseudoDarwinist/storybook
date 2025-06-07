from fastapi import FastAPI, APIRouter, UploadFile, File, Form, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
import uuid
from datetime import datetime
import base64

# Import the story service
from story_service import process_story_request

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")


# Define Models
class StatusCheck(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_name: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)

class StatusCheckCreate(BaseModel):
    client_name: str

# Story Models
class StoryRequest(BaseModel):
    kid_name: str
    age_level: str
    theme: str
    story_type: str
    story_length: str
    special_ingredients: Optional[str] = ""
    
class StoryResponse(BaseModel):
    id: str
    title: str
    moral: str
    story: List[str]
    images: List[Optional[str]]
    created_at: datetime
    
class GeneratedStory(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    kid_name: str
    age_level: str
    theme: str
    story_type: str
    story_length: str
    special_ingredients: Optional[str] = ""
    title: str
    moral: str
    story: List[str]
    image_prompts: List[str]
    images: List[Optional[str]]
    created_at: datetime = Field(default_factory=datetime.utcnow)

# Add your routes to the router instead of directly to app
@api_router.get("/")
async def root():
    return {"message": "Hello World"}

@api_router.post("/status", response_model=StatusCheck)
async def create_status_check(input: StatusCheckCreate):
    status_dict = input.dict()
    status_obj = StatusCheck(**status_dict)
    _ = await db.status_checks.insert_one(status_obj.dict())
    return status_obj

@api_router.get("/status", response_model=List[StatusCheck])
async def get_status_checks():
    status_checks = await db.status_checks.find().to_list(1000)
    return [StatusCheck(**status_check) for status_check in status_checks]

# Story generation endpoints
@api_router.options("/stories/generate")
async def options_generate_story():
    return JSONResponse(content={}, headers={
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "*",
    })

@api_router.post("/stories/generate", response_model=StoryResponse)
async def generate_story(
    background_tasks: BackgroundTasks,
    kid_name: str = Form(...),
    age_level: str = Form(...),
    theme: str = Form(...),
    story_type: str = Form(...),
    story_length: str = Form(...),
    special_ingredients: Optional[str] = Form(""),
    kid_photo: UploadFile = File(...)
):
    try:
        # Read the uploaded photo
        photo_bytes = await kid_photo.read()
        
        # Process the story request
        story_data = await process_story_request(
            kid_name=kid_name,
            kid_photo=photo_bytes,
            age_level=age_level,
            theme=theme,
            story_type=story_type,
            story_length=story_length,
            special_ingredients=special_ingredients
        )
        
        # Create a new story document
        story_doc = GeneratedStory(
            kid_name=kid_name,
            age_level=age_level,
            theme=theme,
            story_type=story_type,
            story_length=story_length,
            special_ingredients=special_ingredients,
            title=story_data["title"],
            moral=story_data["moral"],
            story=story_data["story"],
            image_prompts=story_data["imagePrompts"],
            images=story_data["images"]
        )
        
        # Save to database in the background
        background_tasks.add_task(save_story_to_db, story_doc)
        
        # Return the response
        return StoryResponse(
            id=story_doc.id,
            title=story_doc.title,
            moral=story_doc.moral,
            story=story_doc.story,
            images=story_doc.images,
            created_at=story_doc.created_at
        )
        
    except Exception as e:
        logging.error(f"Error generating story: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to generate story: {str(e)}")

@api_router.get("/stories/{story_id}", response_model=StoryResponse)
async def get_story(story_id: str):
    try:
        story = await db.stories.find_one({"id": story_id})
        if not story:
            raise HTTPException(status_code=404, detail="Story not found")
        
        return StoryResponse(
            id=story["id"],
            title=story["title"],
            moral=story["moral"],
            story=story["story"],
            images=story["images"],
            created_at=story["created_at"]
        )
        
    except Exception as e:
        logging.error(f"Error retrieving story: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to retrieve story: {str(e)}")

@api_router.get("/stories", response_model=List[StoryResponse])
async def get_stories(limit: int = 10, skip: int = 0):
    try:
        stories = await db.stories.find().sort("created_at", -1).skip(skip).limit(limit).to_list(limit)
        
        return [
            StoryResponse(
                id=story["id"],
                title=story["title"],
                moral=story["moral"],
                story=story["story"],
                images=story["images"],
                created_at=story["created_at"]
            )
            for story in stories
        ]
        
    except Exception as e:
        logging.error(f"Error retrieving stories: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to retrieve stories: {str(e)}")

# Helper function to save story to database
async def save_story_to_db(story: GeneratedStory):
    try:
        await db.stories.insert_one(story.dict())
        logging.info(f"Saved story {story.id} to database")
    except Exception as e:
        logging.error(f"Error saving story to database: {str(e)}")

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
