from google import genai
from google.genai import types
from PIL import Image
from io import BytesIO
import base64
import os
import logging
import json
from typing import List, Dict, Any, Optional
import time
import random

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Models
GEMINI_TEXT_MODEL = "gemini-1.5-flash"
GEMINI_VISION_MODEL = "gemini-1.5-flash"
GEMINI_IMAGE_MODEL = "gemini-2.0-flash-preview-image-generation"

# Initialize Gemini API
try:
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        logger.error("GEMINI_API_KEY environment variable is not set")
        raise ValueError("GEMINI_API_KEY environment variable is not set.")
    
    # Configure the client with the API key
    client = genai.Client(api_key=api_key)
    API_INITIALIZED = True
    logger.info("Gemini API configured successfully")
except Exception as e:
    logger.error(f"Failed to initialize Gemini API: {str(e)}")
    API_INITIALIZED = False
    client = None

class Story:
    def __init__(self, title: str, moral: str, story: List[str], imagePrompts: List[str], images: List[bytes] = None):
        self.title = title
        self.moral = moral
        self.story = story
        self.imagePrompts = imagePrompts
        self.images = images or []

    def to_dict(self):
        return {
            "title": self.title,
            "moral": self.moral,
            "story": self.story,
            "imagePrompts": self.imagePrompts,
            "images": [base64.b64encode(img).decode('utf-8') if img else None for img in self.images]
        }

async def analyze_photo(photo_bytes: bytes) -> str:
    """
    Analyze the uploaded photo using Gemini Vision to describe the child
    for better story personalization.
    """
    try:
        logger.info("Analyzing photo with Gemini Vision")
        
        if not API_INITIALIZED or not client:
            logger.error("Gemini API not initialized.")
            return "A cheerful child with a bright smile and curious eyes."

        image = Image.open(BytesIO(photo_bytes))
        logger.info(f"Successfully loaded image: {image.format} {image.size}")
        
        prompt = """
        Describe this child in detail for a storybook character description. 
        Include physical attributes like hair color, eye color, clothing, and any 
        distinctive features. Keep the description child-friendly and positive.
        Focus only on the child in the image.
        Provide the description in 3-4 sentences maximum.
        """
        
        contents = [prompt, image]

        max_retries = 3
        base_delay = 2
        for attempt in range(max_retries):
            try:
                logger.info(f"Sending vision request to Gemini API (attempt {attempt+1}/{max_retries})...")
                response = client.models.generate_content(
                    model=GEMINI_VISION_MODEL,
                    contents=contents
                )
                
                if response.text:
                    logger.info("Successfully analyzed photo")
                    return response.text.strip()
                else:
                    logger.warning("Empty response from Gemini Vision")
            except Exception as retry_error:
                logger.error(f"Error on attempt {attempt+1}: {str(retry_error)}")
                if "429" in str(retry_error) or "quota" in str(retry_error).lower():
                    logger.warning("API quota exceeded or rate limited")
                    break
            if attempt < max_retries - 1:
                delay = base_delay * (2 ** attempt)
                logger.info(f"Retrying in {delay} seconds...")
                time.sleep(delay)
                
        return "A cheerful child with a bright smile and curious eyes."
            
    except Exception as e:
        logger.error(f"Error analyzing photo: {str(e)}")
        return "A cheerful child with a bright smile and curious eyes."

async def generate_story(
    kid_name: str, 
    age_level: str, 
    theme: str, 
    story_type: str, 
    story_length: str, 
    special_ingredients: str,
    child_description: str
) -> Story:
    """
    Generate a personalized story using Gemini based on user input.
    """
    try:
        logger.info(f"Generating story for {kid_name} with theme {theme}")
        
        if not API_INITIALIZED or not client:
            raise Exception("Gemini API not initialized")
        
        length_mapping = {
            "short": 6,
            "medium": 8,
            "long": 12
        }
        sentence_count = length_mapping.get(story_length, 8)
        
        theme_descriptions = {
            "forest": "magical forest with talking animals and ancient trees",
            "space": "outer space adventure with planets, stars, and alien friends",
            "ocean": "underwater kingdom with colorful fish and hidden treasures",
            "kingdom": "magical kingdom with castles, dragons, and wizards",
            "dinosaur": "prehistoric world with friendly dinosaurs and ancient landscapes",
            "custom": special_ingredients or "magical world of wonder and adventure"
        }
        
        theme_description = theme_descriptions.get(theme, theme_descriptions["custom"])
        
        prompt = f"""
        I want you to create a children's story with the following details:
        
        # Character Details:
        - Main character name: {kid_name}
        - Character description: {child_description}
        - Age level: {age_level}
        
        # Story Setting:
        - Theme: {theme_description}
        - Story type: {story_type}
        
        # Special Elements:
        {special_ingredients}
        
        # Specific Instructions:
        1. The story should be appropriate for the age group {age_level}.
        2. The story should be composed of short sentences with simple words that are easy to pronounce.
        3. Make {kid_name} the central character of the story based on the provided description.
        4. The progression of the story should be consistent with a clear start, middle & end with a satisfying conclusion.
        5. Consider using rhyme & repetition in the story & incorporate vivid imagery for the story environment.
        6. The story MUST ALWAYS BE EXACTLY {sentence_count} sentences long. Provide a title as well as a moral.
        7. Once you create the entire story, combining 2 story sentences at a time; create a total of {sentence_count // 2} one line prompts for generating images of the story.
        8. Consider the entire story when creating image prompts.
        9. Always include character information in the prompt. For example, if the character is a human, animal etc.
        10. The prompts should be self contained but also convey the context with respect to the complete story.
        11. DO NOT use markdown in the response & provide the details in the form of the following JSON structure:
        {{
            "title": "Story Title",
            "moral": "The moral of the story",
            "story": ["Sentence 1", "Sentence 2", ...],
            "imagePrompts": ["Image prompt 1", "Image prompt 2", ...]
        }}
        """
        
        max_retries = 3
        base_delay = 2
        for attempt in range(max_retries):
            try:
                logger.info(f"Sending story generation request to Gemini API (attempt {attempt+1}/{max_retries})...")
                response = client.models.generate_content(
                    model=GEMINI_TEXT_MODEL,
                    contents=prompt
                )
                
                if not response.text:
                    logger.warning("Empty response from Gemini")
                    if attempt < max_retries - 1:
                        delay = base_delay * (2 ** attempt)
                        logger.info(f"Retrying in {delay} seconds...")
                        time.sleep(delay)
                        continue
                    else:
                        raise Exception("Failed to generate story content")
                
                text = response.text.strip()
                if text.startswith("```json"):
                    text = text[7:]
                if text.endswith("```"):
                    text = text[:-3]
                    
                logger.info(f"Received response from Gemini, parsing JSON (length: {len(text)})")
                story_data = json.loads(text)
                
                images = await generate_images(story_data["imagePrompts"], " ".join(story_data["story"]))
                
                return Story(
                    title=story_data["title"],
                    moral=story_data["moral"],
                    story=story_data["story"],
                    imagePrompts=story_data["imagePrompts"],
                    images=images
                )
                        
            except (json.JSONDecodeError, Exception) as e:
                logger.error(f"Error on attempt {attempt+1}: {str(e)}")
                if "429" in str(e) or "quota" in str(e).lower():
                    logger.warning("API quota exceeded or rate limited")
                    return await create_fallback_story(kid_name, theme, story_type, story_length, special_ingredients, child_description)
                
                if attempt < max_retries - 1:
                    delay = base_delay * (2 ** attempt)
                    logger.info(f"Retrying in {delay} seconds...")
                    time.sleep(delay)
                else:
                    raise Exception(f"Failed to generate story after {max_retries} attempts: {str(e)}")
            
    except Exception as e:
        logger.error(f"Error generating story: {str(e)}")
        if "429" in str(e) or "quota" in str(e).lower():
            logger.warning("API quota exceeded or rate limited, using fallback story")
            return await create_fallback_story(kid_name, theme, story_type, story_length, special_ingredients, child_description)
        raise

async def generate_images(prompts: List[str], story_context: str) -> List[bytes]:
    """
    Generate images for the story using Gemini's image generation capabilities.
    """
    try:
        logger.info(f"Generating {len(prompts)} images for the story")
        
        if not API_INITIALIZED or not client:
            logger.error("Gemini API not initialized.")
            return [None] * len(prompts)
        
        images = []
        
        for i, prompt in enumerate(prompts):
            max_retries = 3
            base_delay = 2
            
            for attempt in range(max_retries):
                try:
                    enhanced_prompt = f"A children's storybook illustration of: {prompt}. Style: colorful, friendly, vibrant, storybook art."
                    logger.info(f"Generating image {i+1}/{len(prompts)} with prompt: {prompt[:50]}... (attempt {attempt+1}/{max_retries})")
                    
                    response = client.models.generate_content(
                        model=GEMINI_IMAGE_MODEL,
                        contents=enhanced_prompt,
                        config=types.GenerateContentConfig(
                            response_modalities=['TEXT', 'IMAGE']
                        )
                    )

                    logger.info(f"Full response for prompt {i+1}: {response}")
                    
                    image_data = None
                    if response.candidates and response.candidates[0].content and response.candidates[0].content.parts:
                        for part in response.candidates[0].content.parts:
                            if part.inline_data is not None:
                                image_data = part.inline_data.data
                                break
                    
                    if image_data:
                        images.append(image_data)
                        logger.info(f"Successfully generated image {i+1}/{len(prompts)}")
                        break
                    else:
                        logger.warning(f"No image data in response for prompt {i+1} (attempt {attempt+1})")
                        if attempt < max_retries - 1:
                            delay = base_delay * (2 ** attempt)
                            logger.info(f"Retrying in {delay} seconds...")
                            time.sleep(delay)
                        else:
                            images.append(None)
                    
                except Exception as retry_error:
                    logger.error(f"Error generating image {i+1} (attempt {attempt+1}): {str(retry_error)}")
                    if "429" in str(retry_error) or "quota" in str(retry_error).lower():
                        logger.warning("API quota exceeded or rate limited for image generation")
                        images.append(None)
                        break
                        
                    if attempt < max_retries - 1:
                        delay = base_delay * (2 ** attempt)
                        logger.info(f"Retrying in {delay} seconds...")
                        time.sleep(delay)
                    else:
                        images.append(None)
                
            time.sleep(1)
        
        return images
        
    except Exception as e:
        logger.error(f"Error in generate_images: {str(e)}")
        return [None] * len(prompts)

async def create_fallback_story(
    kid_name: str, 
    theme: str, 
    story_type: str, 
    story_length: str, 
    special_ingredients: str,
    child_description: str
) -> Story:
    """
    Create a fallback story when the API is unavailable or quota is exceeded.
    This ensures the app still works even when API quotas are exceeded.
    """
    logger.info(f"Creating fallback story for {kid_name} with theme {theme}")
    
    length_mapping = {
        "short": 6,
        "medium": 8,
        "long": 12
    }
    sentence_count = length_mapping.get(story_length, 8)
    
    fallback_stories = {
        "forest": {
            "title": f"{kid_name}'s Magical Forest Adventure",
            "moral": "Kindness to nature brings unexpected friends and rewards.",
            "story": [
                f"One sunny morning, {kid_name} decided to explore the magical forest near their home.",
                f"The trees whispered secrets as {kid_name} walked deeper into the woods, discovering a hidden path covered with golden leaves.",
                f"Suddenly, a small fox with bright blue eyes appeared and bowed to {kid_name}, saying, 'We've been waiting for you, special one!'",
                f"The fox led {kid_name} to a clearing where animals of all kinds had gathered around an ancient oak tree that sparkled with tiny lights.",
                f"'Our forest is losing its magic,' explained the wise old owl perched on a branch, 'and you have the kind heart needed to help restore it.'",
                f"{kid_name} gently placed their hands on the ancient tree, and immediately felt a warm glow spreading through their fingers.",
                f"As {kid_name} closed their eyes and wished for the forest's magic to return, colorful beams of light shot from their fingertips into the sky.",
                f"The animals cheered as the forest came alive with vibrant colors and magical creatures, and they named {kid_name} their forever friend and protector of the forest."
            ],
            "imagePrompts": [
                f"A child named {kid_name} walking into a magical forest with sunlight streaming through the trees and tiny glowing sprites hiding among the leaves",
                f"A friendly fox with bright blue eyes bowing to {kid_name} on a path covered with golden leaves in an enchanted forest",
                f"{kid_name} standing in a forest clearing surrounded by woodland animals gathered around a giant ancient oak tree that sparkles with magical lights",
                f"{kid_name} with hands on a magical tree trunk, colorful beams of light shooting from their fingertips into the sky as forest animals watch in amazement"
            ]
        },
        "space": {
            "title": f"{kid_name}'s Cosmic Journey",
            "moral": "Courage and friendship can overcome any challenge in the universe.",
            "story": [
                f"{kid_name} was gazing at the stars through their telescope when a small, glowing spaceship landed in their backyard.",
                f"A friendly alien with purple skin and three eyes emerged, introducing itself as Zorb from the planet Lumina.",
                f"'We need your help,' Zorb explained to {kid_name}, 'our planet's cosmic crystal is fading, and without it, our world will lose all its light.'",
                f"Without hesitation, {kid_name} climbed aboard the spaceship, which zoomed through the galaxy past swirling nebulae and shooting stars.",
                f"When they arrived at Lumina, {kid_name} was amazed to see floating cities and rainbow bridges connecting crystal mountains.",
                f"The planet's elders showed {kid_name} the dying crystal at the planet's core, which had lost its sparkle and glow.",
                f"{kid_name} remembered the special stardust they had collected from a meteor shower and sprinkled it gently over the cosmic crystal.",
                f"The crystal immediately burst into brilliant light, saving Lumina, and the grateful aliens made {kid_name} an honorary citizen of their world, promising they would always be friends across the stars."
            ],
            "imagePrompts": [
                f"A child named {kid_name} looking through a telescope at night when a small glowing spaceship lands in their backyard with stars twinkling in the sky",
                f"{kid_name} meeting a friendly purple alien with three eyes named Zorb who has emerged from a spaceship with cosmic light surrounding them",
                f"{kid_name} and alien Zorb flying through space in a glowing spaceship, passing colorful nebulae, planets, and shooting stars",
                f"{kid_name} sprinkling magical stardust over a large crystal at the core of an alien planet, with the crystal bursting into brilliant rainbow light"
            ]
        },
        "ocean": {
            "title": f"{kid_name} and the Underwater Kingdom",
            "moral": "True friendship means helping others in need, no matter how different they may be.",
            "story": [
                f"{kid_name} was playing at the beach when they discovered a beautiful shell that glowed with an otherworldly blue light.",
                f"When {kid_name} picked up the shell, it transformed into a magical pendant that allowed them to breathe underwater.",
                f"Curious and excited, {kid_name} waded into the ocean and dove beneath the waves, discovering an entire kingdom of merpeople living in coral palaces.",
                f"The Mer-King approached {kid_name} and explained that their kingdom was in danger from a dark shadow that was poisoning their waters.",
                f"'Only someone from the surface world with a pure heart can help us,' said the Mer-King, showing {kid_name} how the shadow was spreading through their beautiful home.",
                f"Determined to help, {kid_name} followed the source of the darkness to an old shipwreck where plastic waste from the human world had collected.",
                f"Using the magic of the pendant, {kid_name} created a whirlpool that gathered all the pollution into a ball that they could remove from the ocean.",
                f"The grateful merpeople celebrated {kid_name}'s bravery with an underwater festival of lights, and promised that anytime {kid_name} returned to the sea, they would be welcomed as a hero."
            ],
            "imagePrompts": [
                f"A child named {kid_name} at the beach finding a beautiful shell that glows with magical blue light in their hands",
                f"{kid_name} swimming underwater wearing a glowing blue pendant, approaching a magnificent coral palace where merpeople live",
                f"{kid_name} and the Mer-King looking concerned at a dark shadow spreading through the colorful underwater kingdom",
                f"{kid_name} creating a magical whirlpool underwater that collects pollution, surrounded by grateful merpeople with colorful tails"
            ]
        },
        "kingdom": {
            "title": f"{kid_name} and the Dragon's Gift",
            "moral": "True courage means facing your fears to help others.",
            "story": [
                f"In a kingdom far away, everyone was afraid of the dragon that lived in the mountain cave, except for {kid_name}, who was curious rather than frightened.",
                f"One day, {kid_name} decided to visit the dragon, climbing the winding mountain path with only a lantern and a basket of freshly baked cookies.",
                f"Inside the cave, {kid_name} discovered not a fearsome beast, but a sad dragon named Ember who was crying glittering tears that turned into gemstones when they hit the ground.",
                f"'Everyone is afraid of me,' Ember explained to {kid_name}, 'but I'm actually lonely and just want to make friends with the people in the kingdom.'",
                f"{kid_name} had an idea and invited Ember to visit the kingdom during the annual festival, promising that they would help everyone see how gentle the dragon truly was.",
                f"When the festival day arrived, {kid_name} led Ember to the kingdom square where people initially ran away in fear, hiding behind market stalls and castle walls.",
                f"{kid_name} bravely stood beside Ember and explained to everyone that the dragon only wanted friendship and could help the kingdom with its magical fire that could forge the strongest tools and most beautiful art.",
                f"Slowly, the people approached and welcomed Ember, and from that day forward, the kingdom flourished as {kid_name} and Ember taught everyone that appearances can be deceiving and friendship can be found in the most unexpected places."
            ],
            "imagePrompts": [
                f"A child named {kid_name} climbing a mountain path with a lantern and basket of cookies, approaching a cave with a faint glow coming from inside",
                f"{kid_name} sitting beside a gentle dragon named Ember inside a cave, with the dragon crying glittering tears that turn into gemstones",
                f"{kid_name} leading a colorful dragon named Ember into a medieval kingdom during a festival, with people hiding behind market stalls",
                f"{kid_name} and dragon Ember surrounded by smiling villagers in a medieval kingdom square, with the dragon using magical fire to create beautiful art"
            ]
        },
        "dinosaur": {
            "title": f"{kid_name}'s Prehistoric Adventure",
            "moral": "Teamwork and understanding can overcome the biggest challenges.",
            "story": [
                f"{kid_name} was digging in their backyard when their shovel hit something hard that turned out to be an unusual egg-shaped stone with swirling patterns.",
                f"That night, the stone began to glow and pulse with light, and suddenly {kid_name} found themselves transported to a prehistoric world filled with towering trees and giant ferns.",
                f"A baby Triceratops nudged {kid_name}'s hand, looking up with friendly eyes that seemed to ask for help finding its family.",
                f"{kid_name} and the baby dinosaur set off through the lush jungle, crossing bubbling lava streams and avoiding quicksand pits.",
                f"Along the way, they met other dinosaurs – a helpful Pteranodon that showed them the way from above, and a gentle Brachiosaurus that helped them cross a wide river.",
                f"Suddenly, the ground began to shake as a Tyrannosaurus Rex appeared, but instead of being scary, the T-Rex had a thorn stuck in its foot and was roaring in pain.",
                f"{kid_name} bravely approached the mighty dinosaur and carefully removed the thorn, earning a grateful nod from the T-Rex who then led them to the Triceratops herd.",
                f"After a joyful reunion with the baby's family, the stone began to glow again, and {kid_name} was transported home with a tiny dinosaur footprint fossil as a reminder of their amazing adventure."
            ],
            "imagePrompts": [
                f"A child named {kid_name} in their backyard finding a glowing egg-shaped stone with swirling patterns while digging",
                f"{kid_name} in a prehistoric jungle with a baby Triceratops nudging their hand, surrounded by giant ferns and towering trees",
                f"{kid_name} and a baby Triceratops approaching a T-Rex with a thorn in its foot in a prehistoric landscape with volcanoes in the background",
                f"{kid_name} surrounded by a herd of Triceratops in a prehistoric setting, holding a glowing stone as it begins to transport them home"
            ]
        }
    }
    
    if theme not in fallback_stories:
        theme = "forest"  # Default fallback
    
    fallback_story = fallback_stories[theme]
    
    if len(fallback_story["story"]) != sentence_count:
        if len(fallback_story["story"]) > sentence_count:
            fallback_story["story"] = fallback_story["story"][:sentence_count]
            img_count = sentence_count // 2
            fallback_story["imagePrompts"] = fallback_story["imagePrompts"][:img_count]
        else:
            while len(fallback_story["story"]) < sentence_count:
                fallback_story["story"].append(f"{kid_name} had an amazing adventure and couldn't wait to tell everyone about it.")
            
            img_count = sentence_count // 2
            while len(fallback_story["imagePrompts"]) < img_count:
                fallback_story["imagePrompts"].append(f"{kid_name} having a wonderful adventure in a magical {theme} setting.")
    
    placeholder_images = [None] * len(fallback_story["imagePrompts"])
    
    return Story(
        title=fallback_story["title"],
        moral=fallback_story["moral"],
        story=fallback_story["story"],
        imagePrompts=fallback_story["imagePrompts"],
        images=placeholder_images
    )

async def process_story_request(
    kid_name: str,
    kid_photo: bytes,
    age_level: str,
    theme: str,
    story_type: str,
    story_length: str,
    special_ingredients: str
) -> Dict[str, Any]:
    """
    Process a complete story generation request including photo analysis,
    story generation, and image generation.
    """
    if not API_INITIALIZED:
        logger.warning("API not initialized, using fallback story")
        story = await create_fallback_story(
            kid_name=kid_name, theme=theme, story_type=story_type, story_length=story_length,
            special_ingredients=special_ingredients, child_description="A cheerful child with a bright smile and curious eyes."
        )
        return story.to_dict()

    try:
        child_description = await analyze_photo(kid_photo)
        
        story = await generate_story(
            kid_name=kid_name,
            age_level=age_level,
            theme=theme,
            story_type=story_type,
            story_length=story_length,
            special_ingredients=special_ingredients,
            child_description=child_description
        )
        
        return story.to_dict()
        
    except Exception as e:
        logger.error(f"Error processing story request: {str(e)}")
        
        child_description = "A cheerful child with a bright smile and curious eyes."
        if "child_description" in locals() and locals()["child_description"]:
            child_description = locals()["child_description"]

        story = await create_fallback_story(
            kid_name=kid_name,
            theme=theme,
            story_type=story_type,
            story_length=story_length,
            special_ingredients=special_ingredients,
            child_description=child_description
        )
        return story.to_dict()
