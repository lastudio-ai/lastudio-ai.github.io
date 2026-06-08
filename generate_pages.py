#!/usr/bin/env python3
import os
import json
import shutil
from pathlib import Path

def generate_pages():
    script_dir = Path(__file__).parent.resolve()
    catalog_path = script_dir / "data" / "catalog.json"
    index_tmpl_path = script_dir / "index.html"
    
    if not catalog_path.exists():
        print(f"Error: {catalog_path} not found.")
        return
        
    if not index_tmpl_path.exists():
        print(f"Error: {index_tmpl_path} not found.")
        return

    with open(catalog_path, "r", encoding="utf-8") as f:
        catalog = json.load(f)

    with open(index_tmpl_path, "r", encoding="utf-8") as f:
        index_tmpl = f.read()

    # Build a lookup for family details
    families = {}
    for family in catalog.get("ttsFamilies", []) + catalog.get("sttFamilies", []):
        families[family.get("id")] = family
        if family.get("modelId"):
            families[family.get("modelId")] = family

    # Collect picks
    picks = []
    for collection in catalog.get("modelPicks", []):
        for item in collection.get("items", []):
            picks.append(item)

    print(f"Loaded {len(picks)} LA Studio picks.")
    
    # Remove existing generated models folder to keep it clean
    models_dir = script_dir / "models"
    if models_dir.exists():
        print("Cleaning up old models directory...")
        shutil.rmtree(models_dir)
        
    generated_count = 0
    for pick in picks:
        model_id = pick.get("modelId")
        family_id = pick.get("familyId")
        
        if not model_id:
            continue
            
        # Get details from catalog family
        family = families.get(model_id) or families.get(family_id)
        if not family:
            print(f"Warning: Family metadata not found in catalog for model: {model_id}")
            # Mock family details
            family = {
                "title": model_id.split("/")[-1] if "/" in model_id else model_id,
                "subtitle": "Curated model for LA Studio workflow.",
                "description": pick.get("reason", "LA Studio recommended model.")
            }
            
        title = family.get("title", model_id)
        subtitle = family.get("subtitle", "")
        desc = family.get("description", "")
        
        # Split model_id to author and repo
        parts = model_id.split("/")
        if len(parts) == 2:
            author, repo = parts
        else:
            author = "lastudio"
            repo = model_id
            
        dest_dir = models_dir / author / repo
        dest_dir.mkdir(parents=True, exist_ok=True)
        
        # Prepare custom HTML content
        custom_html = index_tmpl
        
        # Update title & meta description for SEO
        seo_title = f"{title} ({model_id}) - LA Studio Model Catalog"
        seo_desc = f"{subtitle} - {desc}"[:160]
        
        custom_html = custom_html.replace(
            "<title>LA Studio Model Catalog</title>",
            f"<title>{seo_title}</title>"
        )
        custom_html = custom_html.replace(
            '<meta name="description" content="Curated local speech, voice, and transcription models for LA Studio.">',
            f'<meta name="description" content="{seo_desc}">'
        )
        
        # Update assets/scripts paths relative to subfolders
        custom_html = custom_html.replace('href="./styles.css"', 'href="../../../styles.css"')
        custom_html = custom_html.replace('href="./"', 'href="../../../"')
        custom_html = custom_html.replace(
            '<script src="./app.js"></script>',
            '<script>window.catalogUrl = "../../../data/catalog.json";</script>\n    <script src="../../../app.js"></script>'
        )
        
        # Write file
        dest_file = dest_dir / "index.html"
        with open(dest_file, "w", encoding="utf-8") as f:
            f.write(custom_html)
            
        print(f"Generated page: models/{author}/{repo}/index.html")
        generated_count += 1

    print(f"Successfully generated {generated_count} model page(s).")

if __name__ == "__main__":
    generate_pages()
