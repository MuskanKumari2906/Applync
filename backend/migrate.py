import os
from sqlalchemy import create_engine, inspect, text
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    print("Error: DATABASE_URL not set in .env")
    exit(1)

print(f"Connecting to database: {DATABASE_URL.split('@')[-1]}")
engine = create_engine(DATABASE_URL)

# Columns to add if they don't exist
new_columns = [
    ("job_description", "TEXT"),
    ("current_interview_round", "INTEGER DEFAULT 0"),
    ("is_starred", "BOOLEAN DEFAULT FALSE"),
    ("deadline_date", "TIMESTAMP"),
    ("company_size", "VARCHAR"),
    ("company_industry", "VARCHAR"),
    ("location", "VARCHAR")
]

inspector = inspect(engine)
columns_in_db = [c["name"] for c in inspector.get_columns("job_applications")]

print("Checking existing columns in 'job_applications'...")
with engine.begin() as conn:
    for col_name, col_type in new_columns:
        if col_name not in columns_in_db:
            print(f"Adding column '{col_name}' ({col_type})...")
            try:
                conn.execute(text(f"ALTER TABLE job_applications ADD COLUMN {col_name} {col_type};"))
                print(f"Successfully added column '{col_name}'")
            except Exception as e:
                print(f"Error adding column '{col_name}': {e}")
        else:
            print(f"Column '{col_name}' already exists.")

# Check users columns
user_columns = [c["name"] for c in inspector.get_columns("users")]
new_user_columns = [
    ("theme_preference", "VARCHAR DEFAULT 'dark'"),
    ("resume_text", "TEXT")
]

print("Checking existing columns in 'users'...")
with engine.begin() as conn:
    for col_name, col_type in new_user_columns:
        if col_name not in user_columns:
            print(f"Adding column '{col_name}' ({col_type}) to 'users' table...")
            try:
                conn.execute(text(f"ALTER TABLE users ADD COLUMN {col_name} {col_type};"))
                print(f"Successfully added column '{col_name}' to users")
            except Exception as e:
                print(f"Error adding column '{col_name}' to users: {e}")
        else:
            print(f"Column '{col_name}' already exists in users.")

print("Migration check completed!")
