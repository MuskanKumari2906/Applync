from fastapi import FastAPI, Depends, HTTPException, status, BackgroundTasks, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy import (
    create_engine, Column, Integer, String, DateTime, Text,
    ForeignKey, Boolean, Float
)
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session, relationship
from pydantic import BaseModel
from datetime import datetime, timedelta
import os
import re
from dotenv import load_dotenv
import jwt
import bcrypt
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Optional, List

load_dotenv()

# ============ DATABASE SETUP ============

DATABASE_URL = os.getenv("DATABASE_URL")
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# FastAPI app
app = FastAPI(title="Applync API", version="2.0.0")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuration
SECRET_KEY = os.getenv("SECRET_KEY", "your-secret-key-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", 1440))  # 24h default

# ============ DATABASE MODELS ============

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True)
    password_hash = Column(String)
    name = Column(String)
    theme_preference = Column(String, default="dark")
    resume_text = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    @property
    def full_name(self) -> str:
        return self.name or ""


class JobApplication(Base):
    """
    Core job application record.

    SQL migration for existing databases (run once on Render):
    ALTER TABLE job_applications
      ADD COLUMN IF NOT EXISTS job_description TEXT,
      ADD COLUMN IF NOT EXISTS current_interview_round INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS is_starred BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS deadline_date TIMESTAMP,
      ADD COLUMN IF NOT EXISTS company_size VARCHAR,
      ADD COLUMN IF NOT EXISTS company_industry VARCHAR,
      ADD COLUMN IF NOT EXISTS location VARCHAR;
    """
    __tablename__ = "job_applications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    company_name = Column(String)
    job_title = Column(String)
    job_url = Column(String, nullable=True)
    job_description = Column(Text, nullable=True)       # NEW: full JD text for parsing
    status = Column(String, default="applied", index=True)
    current_interview_round = Column(Integer, default=0) # NEW: 0=none, 1,2,3…
    application_date = Column(DateTime, default=datetime.utcnow)
    follow_up_date = Column(DateTime, nullable=True)
    deadline_date = Column(DateTime, nullable=True)      # NEW: response/decision deadline
    notes = Column(Text, nullable=True)
    salary_range = Column(String, nullable=True)
    is_starred = Column(Boolean, default=False)          # NEW: bookmark
    company_size = Column(String, nullable=True)         # NEW: startup/mid/large
    company_industry = Column(String, nullable=True)     # NEW: tech/finance/etc
    location = Column(String, nullable=True)             # NEW: remote/city
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    interviews = relationship("Interview", back_populates="job", cascade="all, delete-orphan")
    offer = relationship("Offer", back_populates="job", uselist=False, cascade="all, delete-orphan")
    timeline_events = relationship("TimelineEvent", back_populates="job", cascade="all, delete-orphan")

    @property
    def position_title(self) -> str:
        return self.job_title or ""


class Interview(Base):
    """
    Interview round tracker.

    SQL migration for existing databases:
    CREATE TABLE IF NOT EXISTS interviews (
      id SERIAL PRIMARY KEY,
      job_id INTEGER REFERENCES job_applications(id) ON DELETE CASCADE,
      round_number INTEGER DEFAULT 1,
      interview_type VARCHAR,
      scheduled_date TIMESTAMP,
      interviewer_name VARCHAR,
      platform VARCHAR,
      duration_minutes INTEGER,
      status VARCHAR DEFAULT 'scheduled',
      feedback TEXT,
      difficulty_rating INTEGER,
      performance_rating INTEGER,
      what_went_well TEXT,
      improvements TEXT,
      follow_up_actions TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
    """
    __tablename__ = "interviews"

    id = Column(Integer, primary_key=True, index=True)
    job_id = Column(Integer, ForeignKey("job_applications.id"), index=True)
    round_number = Column(Integer, default=1)
    interview_type = Column(String, default="phone_screen")  # phone_screen|technical|hr|culture_fit|system_design|case_study
    scheduled_date = Column(DateTime, nullable=True)
    interviewer_name = Column(String, nullable=True)
    platform = Column(String, nullable=True)               # google_meet|zoom|phone|in_person|teams
    duration_minutes = Column(Integer, nullable=True)
    status = Column(String, default="scheduled")           # scheduled|completed|passed|failed|cancelled
    feedback = Column(Text, nullable=True)                 # general feedback/notes
    difficulty_rating = Column(Integer, nullable=True)     # 1-5
    performance_rating = Column(Integer, nullable=True)    # 1-5
    what_went_well = Column(Text, nullable=True)
    improvements = Column(Text, nullable=True)
    follow_up_actions = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    job = relationship("JobApplication", back_populates="interviews")


class Offer(Base):
    """
    Offer details for a job application.

    SQL migration for existing databases:
    CREATE TABLE IF NOT EXISTS offers (
      id SERIAL PRIMARY KEY,
      job_id INTEGER UNIQUE REFERENCES job_applications(id) ON DELETE CASCADE,
      ctc FLOAT,
      base_salary FLOAT,
      bonus_percent FLOAT,
      stock_options TEXT,
      benefits TEXT,
      negotiation_status VARCHAR DEFAULT 'pending',
      offer_date TIMESTAMP,
      response_deadline TIMESTAMP,
      acceptance_date TIMESTAMP,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
    """
    __tablename__ = "offers"

    id = Column(Integer, primary_key=True, index=True)
    job_id = Column(Integer, ForeignKey("job_applications.id"), unique=True)
    ctc = Column(Float, nullable=True)                    # cost to company (annual)
    base_salary = Column(Float, nullable=True)
    bonus_percent = Column(Float, nullable=True)
    stock_options = Column(Text, nullable=True)
    benefits = Column(Text, nullable=True)
    negotiation_status = Column(String, default="pending") # pending|accepted|rejected|negotiating
    offer_date = Column(DateTime, nullable=True)
    response_deadline = Column(DateTime, nullable=True)
    acceptance_date = Column(DateTime, nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    job = relationship("JobApplication", back_populates="offer")


class TimelineEvent(Base):
    """
    Audit trail for key state changes on a job application.

    SQL migration for existing databases:
    CREATE TABLE IF NOT EXISTS timeline_events (
      id SERIAL PRIMARY KEY,
      job_id INTEGER REFERENCES job_applications(id) ON DELETE CASCADE,
      event_type VARCHAR,
      event_date TIMESTAMP DEFAULT NOW(),
      event_details TEXT
    );
    """
    __tablename__ = "timeline_events"

    id = Column(Integer, primary_key=True, index=True)
    job_id = Column(Integer, ForeignKey("job_applications.id"), index=True)
    event_type = Column(String)   # application_sent|status_changed|interview_scheduled|interview_completed|offer_received|rejected|note_added
    event_date = Column(DateTime, default=datetime.utcnow)
    event_details = Column(Text, nullable=True)

    job = relationship("JobApplication", back_populates="timeline_events")


# ============ PYDANTIC SCHEMAS ============

# --- Auth ---

class UserRegister(BaseModel):
    email: str
    password: str
    full_name: str

class UserLogin(BaseModel):
    email: str
    password: str

class UserResponse(BaseModel):
    id: int
    email: str
    full_name: str
    theme_preference: Optional[str] = "dark"
    resume_text: Optional[str] = None

    class Config:
        from_attributes = True

class UserUpdate(BaseModel):
    email: Optional[str] = None
    full_name: Optional[str] = None
    password: Optional[str] = None
    theme_preference: Optional[str] = None
    resume_text: Optional[str] = None

class TokenResponse(BaseModel):
    access_token: str
    token_type: str
    user: UserResponse

# --- Jobs ---

class JobApplicationCreate(BaseModel):
    company_name: str
    position_title: str
    job_url: Optional[str] = None
    job_description: Optional[str] = None
    status: str = "applied"
    application_date: Optional[datetime] = None
    deadline_date: Optional[datetime] = None
    notes: Optional[str] = None
    salary_range: Optional[str] = None
    is_starred: Optional[bool] = False
    company_size: Optional[str] = None
    company_industry: Optional[str] = None
    location: Optional[str] = None

class JobApplicationUpdate(BaseModel):
    company_name: Optional[str] = None
    position_title: Optional[str] = None
    job_url: Optional[str] = None
    job_description: Optional[str] = None
    status: Optional[str] = None
    application_date: Optional[datetime] = None
    follow_up_date: Optional[datetime] = None
    deadline_date: Optional[datetime] = None
    notes: Optional[str] = None
    salary_range: Optional[str] = None
    is_starred: Optional[bool] = None
    current_interview_round: Optional[int] = None
    company_size: Optional[str] = None
    company_industry: Optional[str] = None
    location: Optional[str] = None

class JobApplicationResponse(BaseModel):
    id: int
    user_id: int
    company_name: str
    position_title: str
    job_url: Optional[str]
    job_description: Optional[str]
    status: str
    current_interview_round: int
    application_date: datetime
    follow_up_date: Optional[datetime]
    deadline_date: Optional[datetime]
    notes: Optional[str]
    salary_range: Optional[str]
    is_starred: bool
    company_size: Optional[str]
    company_industry: Optional[str]
    location: Optional[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

# --- Interviews ---

class InterviewCreate(BaseModel):
    round_number: int = 1
    interview_type: str = "phone_screen"
    scheduled_date: Optional[datetime] = None
    interviewer_name: Optional[str] = None
    platform: Optional[str] = None
    duration_minutes: Optional[int] = None
    status: str = "scheduled"
    feedback: Optional[str] = None
    difficulty_rating: Optional[int] = None
    performance_rating: Optional[int] = None
    what_went_well: Optional[str] = None
    improvements: Optional[str] = None
    follow_up_actions: Optional[str] = None

class InterviewUpdate(BaseModel):
    round_number: Optional[int] = None
    interview_type: Optional[str] = None
    scheduled_date: Optional[datetime] = None
    interviewer_name: Optional[str] = None
    platform: Optional[str] = None
    duration_minutes: Optional[int] = None
    status: Optional[str] = None
    feedback: Optional[str] = None
    difficulty_rating: Optional[int] = None
    performance_rating: Optional[int] = None
    what_went_well: Optional[str] = None
    improvements: Optional[str] = None
    follow_up_actions: Optional[str] = None

class InterviewResponse(BaseModel):
    id: int
    job_id: int
    round_number: int
    interview_type: str
    scheduled_date: Optional[datetime]
    interviewer_name: Optional[str]
    platform: Optional[str]
    duration_minutes: Optional[int]
    status: str
    feedback: Optional[str]
    difficulty_rating: Optional[int]
    performance_rating: Optional[int]
    what_went_well: Optional[str]
    improvements: Optional[str]
    follow_up_actions: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True

# --- Offers ---

class OfferCreate(BaseModel):
    ctc: Optional[float] = None
    base_salary: Optional[float] = None
    bonus_percent: Optional[float] = None
    stock_options: Optional[str] = None
    benefits: Optional[str] = None
    negotiation_status: str = "pending"
    offer_date: Optional[datetime] = None
    response_deadline: Optional[datetime] = None
    acceptance_date: Optional[datetime] = None
    notes: Optional[str] = None

class OfferUpdate(BaseModel):
    ctc: Optional[float] = None
    base_salary: Optional[float] = None
    bonus_percent: Optional[float] = None
    stock_options: Optional[str] = None
    benefits: Optional[str] = None
    negotiation_status: Optional[str] = None
    offer_date: Optional[datetime] = None
    response_deadline: Optional[datetime] = None
    acceptance_date: Optional[datetime] = None
    notes: Optional[str] = None

class OfferResponse(BaseModel):
    id: int
    job_id: int
    ctc: Optional[float]
    base_salary: Optional[float]
    bonus_percent: Optional[float]
    stock_options: Optional[str]
    benefits: Optional[str]
    negotiation_status: str
    offer_date: Optional[datetime]
    response_deadline: Optional[datetime]
    acceptance_date: Optional[datetime]
    notes: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True

# --- Parse ---

class ParseRequest(BaseModel):
    text: str   # Pasted job description text to parse

class ParseResponse(BaseModel):
    company_name: Optional[str]
    position_title: Optional[str]
    location: Optional[str]
    salary_range: Optional[str]
    company_industry: Optional[str]
    skills: List[str]
    deadline: Optional[str]
    raw_text_preview: str  # First 300 chars for verification

# --- Timeline ---

class TimelineEventResponse(BaseModel):
    id: int
    job_id: int
    event_type: str
    event_date: datetime
    event_details: Optional[str]

    class Config:
        from_attributes = True

# ============ UTILITY FUNCTIONS ============

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

def verify_password(password: str, hash: str) -> bool:
    return bcrypt.checkpw(password.encode(), hash.encode())

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=15))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def verify_token(token: str):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise HTTPException(status_code=401, detail="Invalid token")
        return email
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

security = HTTPBearer(auto_error=False)

def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db)
):
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    email = verify_token(credentials.credentials)
    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user

def get_job_or_404(job_id: int, user_id: int, db: Session) -> JobApplication:
    """Fetch job by ID + user ownership or raise 404."""
    job = db.query(JobApplication).filter(
        JobApplication.id == job_id,
        JobApplication.user_id == user_id
    ).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job

def add_timeline_event(db: Session, job_id: int, event_type: str, details: str = None):
    """Insert a timeline audit event."""
    event = TimelineEvent(
        job_id=job_id,
        event_type=event_type,
        event_details=details,
        event_date=datetime.utcnow()
    )
    db.add(event)
    db.commit()

# ============ JD PARSER UTILITY ============

# Common tech skills list for extraction
KNOWN_SKILLS = [
    "Python", "Java", "JavaScript", "TypeScript", "Go", "Rust", "C++", "C#",
    "React", "Vue", "Angular", "Node.js", "FastAPI", "Django", "Flask", "Spring",
    "SQL", "PostgreSQL", "MySQL", "MongoDB", "Redis", "Elasticsearch",
    "Docker", "Kubernetes", "AWS", "GCP", "Azure", "Terraform", "CI/CD",
    "Machine Learning", "Deep Learning", "TensorFlow", "PyTorch", "NLP",
    "REST API", "GraphQL", "Microservices", "Git", "Linux",
    "Agile", "Scrum", "Figma", "Jira", "Confluence",
    "Excel", "Tableau", "Power BI", "Data Analysis", "Statistics",
]

def extract_company_name(text: str) -> Optional[str]:
    # 1. "Company: <Name>" or "Employer: <Name>" (strictly requiring a colon to prevent matching middle-of-sentence words)
    m = re.search(r"\b(?:Company|Employer|Organization|Firm|Agency)\s*:\s*([A-Z][A-Za-z0-9\s&,\.]{1,40})", text, re.IGNORECASE)
    if m:
        return m.group(1).strip()

    # 2. "at <Company>" after a job title, e.g. "Software Engineer at Microsoft"
    m = re.search(r"\b(?:Engineer|Developer|Intern|Manager|Analyst|Designer|Specialist)\s+at\s+([A-Z][A-Za-z0-9&,\.\s]{1,30})\b", text, re.IGNORECASE)
    if m:
        name = m.group(1).strip()
        if name.lower() not in ["the", "a", "an", "our", "any", "some", "work", "this", "home", "remote"]:
            return name

    # 3. "About <Company>" or "Join <Company>" at the start of a paragraph or sentence
    m = re.search(r"\b(?:About|Join|Welcome to)\s+([A-Z][A-Za-z0-9&,\.\s]{1,30})\b", text)
    if m:
        name = m.group(1).strip()
        if name.lower() not in ["our", "the", "this", "us", "we", "your", "a", "an"]:
            return name

    # 4. Fallback: <Company> "is looking for" / "is hiring"
    m = re.search(r"\b([A-Z][A-Za-z0-9&,\.\s]{1,30})\s+(?:is\s+(?:looking\s+for|hiring|seeking|recruiting))\b", text)
    if m:
        return m.group(1).strip()

    return None

def extract_position_title(text: str) -> Optional[str]:
    # 1. "Role:", "Position:", "Job Title:"
    m = re.search(r"\b(?:Role|Position|Job Title|Title)\s*:\s*([A-Za-z0-9\s\-/]{3,60})", text, re.IGNORECASE)
    if m:
        return m.group(1).strip()

    # 2. Look for common engineering/business titles
    title_patterns = [
        r"(?:We are (?:hiring|looking) for (?:an? )?)([\w\s\-]+?)(?:\s+to|\s+who|\s+at|\n)",
        r"\b(?:Senior|Junior|Lead|Staff|Principal|Associate|Graduate)?\s*[A-Za-z\s\-]+\s*(?:Engineer|Developer|Analyst|Manager|Designer|Scientist|Consultant|Architect|Intern)\b"
    ]
    for pattern in title_patterns:
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            title = m.group(1).strip() if m.lastindex else m.group(0).strip()
            # Clean common prefix wrappers
            title = re.sub(r'^(?:As a|As an|Role of|Position of|We are hiring a|We are hiring an|We are looking for a|We are looking for an)\s+', '', title, flags=re.IGNORECASE)
            if 5 < len(title) < 60:
                return title

    return None

def parse_jd_text(text: str) -> dict:
    """
    Extract structured data from a pasted job description using regex.
    Returns best-effort extraction — user can edit before saving.
    """
    result = {
        "company_name": extract_company_name(text),
        "position_title": extract_position_title(text),
        "location": None,
        "salary_range": None,
        "company_industry": None,
        "skills": [],
        "deadline": None,
        "raw_text_preview": text[:300].strip()
    }

    # --- Salary range: various currency formats ---
    salary_patterns = [
        r"(?:salary|ctc|compensation|pay|package)[:\s]*(?:₹|Rs\.?|INR|USD|\$|€|£)?\s*([\d,\.]+\s*(?:[-–to\s]+)?\s*(?:₹|Rs\.?|INR|USD|\$|€|£)?\s*[\d,\.]+\s*(?:LPA|lakh|lac|k|K|L|per annum|PA|annually|/hr|/hour|hr|hour|USD|INR)?)",
        r"((?:₹|Rs\.?|INR|USD|\$|€|£)\s*[\d,\.]+\s*(?:[-–to\s]+)?\s*(?:(?:₹|Rs\.?|INR|USD|\$|€|£)\s*)?[\d,\.]+\s*(?:LPA|lakh|lac|k|K|L|per annum|PA|annually|/hr|/hour|hr|hour)?)",
        r"([\d,\.]+\s*[-–to\s]+\s*[\d,\.]+\s*(?:LPA|lakh|lac|L))",
    ]
    for pattern in salary_patterns:
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            val = m.group(1).strip() if m.lastindex else m.group(0).strip()
            if val:
                result["salary_range"] = val[:60]
                break

    # --- Location ---
    location_patterns = [
        r"(?:Location|Office|Based in|Onsite|Remote|Hybrid)[:\s]+([A-Za-z\s,]+?)(?:\n|,\s*(?:Full|Part|Contract)|$)",
        r"\b(Remote(?:\s*\(.*?\))?|Hybrid|Work from Home|WFH|On-?site)\b",
        r"(?:Bengaluru|Bangalore|Mumbai|Delhi|Hyderabad|Pune|Chennai|Kolkata|New York|San Francisco|London|Singapore|Berlin|Toronto)",
    ]
    for pattern in location_patterns:
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            loc = (m.group(1) if m.lastindex else m.group(0)).strip().rstrip(",.")
            if len(loc) < 100:
                result["location"] = loc
                break

    # --- Deadline ---
    deadline_patterns = [
        r"(?:apply by|deadline|last date|closing date|applications close)[:\s]+(\d{1,2}[\s/-]\w+[\s/-]\d{2,4}|\w+ \d{1,2},?\s*\d{4})",
        r"(?:apply before)[:\s]+(\d{1,2}[\s/-]\w+[\s/-]\d{2,4})",
    ]
    for pattern in deadline_patterns:
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            result["deadline"] = m.group(1).strip()
            break

    # --- Skills: match against known skill list ---
    found_skills = []
    for skill in KNOWN_SKILLS:
        if re.search(r'\b' + re.escape(skill) + r'\b', text, re.IGNORECASE):
            found_skills.append(skill)
    result["skills"] = found_skills[:15]  # cap at 15

    return result

# ============ BACKGROUND TASKS ============

SMTP_HOST = os.getenv("SMTP_HOST")
SMTP_PORT = int(os.getenv("SMTP_PORT", 587))
SMTP_USER = os.getenv("SMTP_USER")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD")
SENDER_EMAIL = os.getenv("SENDER_EMAIL", "noreply@applync.com")

def send_email_notification(to_email: str, subject: str, html_content: str):
    if not SMTP_HOST or not SMTP_USER or not SMTP_PASSWORD:
        print(f"[EMAIL MOCK] To: {to_email} | Subject: {subject}")
        print(f"[EMAIL CONTENT PREVIEW]\n{html_content[:300]}...\n-------------------")
        return
    
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = f"Applync Reminders <{SENDER_EMAIL}>"
        msg["To"] = to_email
        msg.attach(MIMEText(html_content, "html"))

        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.sendmail(SENDER_EMAIL, to_email, msg.as_string())
        print(f"[EMAIL SENT] Successfully sent email to {to_email}: {subject}")
    except Exception as e:
        print(f"[EMAIL ERROR] Failed to send email to {to_email}: {e}")

def send_welcome_email_task(email: str, name: str):
    subject = "Welcome to Applync! 🚀"
    html = f"""
    <html>
      <body style="font-family: Arial, sans-serif; color: #333;">
        <h2>Hi {name}, welcome to Applync!</h2>
        <p>Your job application tracker is now ready. Start adding your applications, scheduling interviews, and tracking offers!</p>
        <br/>
        <p>Best regards,<br/>The Applync Team</p>
      </body>
    </html>
    """
    send_email_notification(email, subject, html)

def send_interview_scheduled_email(email: str, name: str, company: str, position: str, round_num: int, scheduled_date: Optional[datetime], platform: Optional[str]):
    subject = f"Interview Scheduled: {position} at {company} (Round {round_num})"
    date_str = scheduled_date.strftime("%B %d, %Y at %I:%M %p") if scheduled_date else "TBD"
    html = f"""
    <html>
      <body style="font-family: Arial, sans-serif; color: #333;">
        <h2>Hi {name},</h2>
        <p>An interview has been scheduled for your application:</p>
        <table style="border-collapse: collapse; width: 100%; max-width: 500px;">
          <tr><td style="padding: 8px 0; font-weight: bold; border-bottom: 1px solid #eee;">Company:</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">{company}</td></tr>
          <tr><td style="padding: 8px 0; font-weight: bold; border-bottom: 1px solid #eee;">Role:</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">{position}</td></tr>
          <tr><td style="padding: 8px 0; font-weight: bold; border-bottom: 1px solid #eee;">Round:</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">Round {round_num}</td></tr>
          <tr><td style="padding: 8px 0; font-weight: bold; border-bottom: 1px solid #eee;">Scheduled For:</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">{date_str}</td></tr>
          <tr><td style="padding: 8px 0; font-weight: bold; border-bottom: 1px solid #eee;">Platform:</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">{platform or 'TBD'}</td></tr>
        </table>
        <p>Prepare well and good luck! 👍</p>
        <br/>
        <p>Best regards,<br/>The Applync Team</p>
      </body>
    </html>
    """
    send_email_notification(email, subject, html)

def log_status_change_task(email: str, company: str, position: str, new_status: str):
    print(f"[BACKGROUND] Status change: {email} → {position} @ {company} → '{new_status}'")

def check_and_send_reminders(user_id: int, db_session_factory):
    # Runs in background to check upcoming deadlines and interviews 1 day away
    db = db_session_factory()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            return

        now = datetime.utcnow()
        one_day_later = now + timedelta(days=1)
        two_days_later = now + timedelta(days=2)

        # 1. Check Interviews in next 24 hours
        upcoming_interviews = db.query(Interview).join(JobApplication).filter(
            JobApplication.user_id == user_id,
            Interview.scheduled_date >= one_day_later - timedelta(hours=6),
            Interview.scheduled_date <= one_day_later + timedelta(hours=6),
            Interview.status == "scheduled"
        ).all()

        for iv in upcoming_interviews:
            job = iv.job
            # Prevent duplicate emails for same interview round
            reminder_key = f"reminder_sent_interview_{iv.id}_{now.strftime('%Y-%m-%d')}"
            exists = db.query(TimelineEvent).filter(
                TimelineEvent.job_id == job.id,
                TimelineEvent.event_type == "reminder_sent",
                TimelineEvent.event_details.like(f"%{reminder_key}%")
            ).first()

            if not exists:
                subject = f"🔔 Interview Tomorrow: {job.job_title} at {job.company_name}"
                html = f"""
                <html>
                  <body style="font-family: Arial, sans-serif; color: #333;">
                    <h2>Hi {user.name},</h2>
                    <p>This is a reminder that you have an interview scheduled for tomorrow:</p>
                    <p><strong>Round {iv.round_number} ({iv.interview_type.replace('_', ' ').title()})</strong> at {job.company_name} for the position of <strong>{job.job_title}</strong>.</p>
                    <p>Platform: {iv.platform or 'TBD'}</p>
                    <p>Interviewer: {iv.interviewer_name or 'TBD'}</p>
                    <p>Good luck!</p>
                  </body>
                </html>
                """
                send_email_notification(user.email, subject, html)
                
                # Log event to prevent duplicate
                event = TimelineEvent(job_id=job.id, event_type="reminder_sent", event_details=f"Interview tomorrow reminder: {reminder_key}")
                db.add(event)
                db.commit()

        # 2. Check Job Deadlines in next 24 hours
        upcoming_deadlines = db.query(JobApplication).filter(
            JobApplication.user_id == user_id,
            JobApplication.deadline_date >= one_day_later - timedelta(hours=6),
            JobApplication.deadline_date <= one_day_later + timedelta(hours=6),
            JobApplication.status.notin_(["rejected", "withdrawn", "archived"])
        ).all()

        for job in upcoming_deadlines:
            reminder_key = f"reminder_sent_deadline_{job.id}_{now.strftime('%Y-%m-%d')}"
            exists = db.query(TimelineEvent).filter(
                TimelineEvent.job_id == job.id,
                TimelineEvent.event_type == "reminder_sent",
                TimelineEvent.event_details.like(f"%{reminder_key}%")
            ).first()

            if not exists:
                subject = f"🚨 Application Deadline Tomorrow: {job.company_name}"
                html = f"""
                <html>
                  <body style="font-family: Arial, sans-serif; color: #333;">
                    <h2>Hi {user.name},</h2>
                    <p>This is a reminder that the deadline for <strong>{job.job_title}</strong> at <strong>{job.company_name}</strong> is tomorrow!</p>
                    <p>Current Status: {job.status.title()}</p>
                    <p>Make sure to complete any pending actions.</p>
                  </body>
                </html>
                """
                send_email_notification(user.email, subject, html)

                event = TimelineEvent(job_id=job.id, event_type="reminder_sent", event_details=f"Deadline tomorrow reminder: {reminder_key}")
                db.add(event)
                db.commit()

    except Exception as e:
        print(f"[BACKGROUND REMINDER ERROR] {e}")
    finally:
        db.close()

# ============ CREATE TABLES ============
Base.metadata.create_all(bind=engine)

# ============ ENDPOINTS ============

@app.get("/")
def read_root():
    return {"message": "Applync API v2.0 is running!", "docs": "/docs"}

# ─── AUTH ───────────────────────────────────────────────────────────────────

@app.post("/auth/register", response_model=TokenResponse)
def register(user_data: UserRegister, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Register a new user account."""
    if db.query(User).filter(User.email == user_data.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")

    new_user = User(
        email=user_data.email,
        password_hash=hash_password(user_data.password),
        name=user_data.full_name
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    background_tasks.add_task(send_welcome_email_task, new_user.email, new_user.full_name)

    return {
        "access_token": create_access_token(
            data={"sub": new_user.email},
            expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
        ),
        "token_type": "bearer",
        "user": new_user
    }

@app.post("/auth/login", response_model=TokenResponse)
def login(user_data: UserLogin, db: Session = Depends(get_db)):
    """Authenticate and return JWT."""
    user = db.query(User).filter(User.email == user_data.email).first()
    if not user or not verify_password(user_data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    return {
        "access_token": create_access_token(
            data={"sub": user.email},
            expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
        ),
        "token_type": "bearer",
        "user": user
    }

@app.get("/auth/me", response_model=UserResponse)
def get_me(background_tasks: BackgroundTasks, current_user: User = Depends(get_current_user)):
    background_tasks.add_task(check_and_send_reminders, current_user.id, lambda: SessionLocal())
    return current_user

@app.put("/auth/me", response_model=UserResponse)
def update_me(
    user_update: UserUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update profile (name, email, password)."""
    if user_update.email:
        existing = db.query(User).filter(
            User.email == user_update.email,
            User.id != current_user.id
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail="Email already taken")
        current_user.email = user_update.email
    if user_update.full_name:
        current_user.name = user_update.full_name
    if user_update.password:
        if len(user_update.password) < 8:
            raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
        current_user.password_hash = hash_password(user_update.password)

    if user_update.theme_preference is not None:
        current_user.theme_preference = user_update.theme_preference
    if user_update.resume_text is not None:
        current_user.resume_text = user_update.resume_text

    db.commit()
    db.refresh(current_user)
    return current_user

@app.post("/auth/resume/upload")
def upload_resume(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Upload and parse a resume file (PDF or TXT) and store the parsed text in the user's profile."""
    contents = file.file.read()
    text_content = ""
    
    if file.filename.endswith(".pdf"):
        try:
            import io
            import pypdf
            reader = pypdf.PdfReader(io.BytesIO(contents))
            text_runs = []
            for page in reader.pages:
                t = page.extract_text()
                if t:
                    text_runs.append(t)
            text_content = "\n".join(text_runs)
        except ImportError:
            raise HTTPException(
                status_code=500,
                detail="pypdf package is not installed. Please run 'pip install pypdf'."
            )
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to parse PDF: {str(e)}")
    elif file.filename.endswith((".txt", ".md")):
        try:
            text_content = contents.decode("utf-8")
        except Exception:
            text_content = contents.decode("latin-1")
    else:
        raise HTTPException(
            status_code=400,
            detail="Unsupported file format. Please upload a PDF or TXT file."
        )

    if not text_content.strip():
        raise HTTPException(status_code=400, detail="Could not extract any text from the uploaded file.")

    current_user.resume_text = text_content
    db.commit()
    db.refresh(current_user)
    
    return {"message": "Resume uploaded successfully", "resume_text": text_content}


# ─── JOB DESCRIPTION PARSER ──────────────────────────────────────────────────

@app.post("/jobs/parse", response_model=ParseResponse)
def parse_job_description(
    req: ParseRequest,
    current_user: User = Depends(get_current_user)
):
    """
    Parse pasted job description text and extract structured fields.
    Returns best-effort extraction for user to verify before saving.
    """
    if not req.text or len(req.text.strip()) < 20:
        raise HTTPException(status_code=400, detail="Please provide more job description text (at least 20 characters)")
    return parse_jd_text(req.text)

# ─── JOBS CRUD ────────────────────────────────────────────────────────────────

@app.post("/jobs", response_model=JobApplicationResponse)
def create_job(
    job: JobApplicationCreate,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a new job application."""
    new_job = JobApplication(
        user_id=current_user.id,
        company_name=job.company_name,
        job_title=job.position_title,
        job_url=job.job_url,
        job_description=job.job_description,
        status=job.status,
        application_date=job.application_date or datetime.utcnow(),
        deadline_date=job.deadline_date,
        notes=job.notes,
        salary_range=job.salary_range,
        is_starred=job.is_starred or False,
        company_size=job.company_size,
        company_industry=job.company_industry,
        location=job.location,
    )
    db.add(new_job)
    db.commit()
    db.refresh(new_job)

    # Auto-create first timeline event
    add_timeline_event(db, new_job.id, "application_sent",
                       f"Applied to {job.position_title} at {job.company_name}")
    return new_job

@app.get("/jobs", response_model=List[JobApplicationResponse])
def get_jobs(
    status: Optional[str] = None,
    is_starred: Optional[bool] = None,
    search: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all jobs with optional filtering by status, starred, or search query."""
    query = db.query(JobApplication).filter(JobApplication.user_id == current_user.id)
    if status:
        query = query.filter(JobApplication.status == status)
    if is_starred is not None:
        query = query.filter(JobApplication.is_starred == is_starred)
    if search:
        pattern = f"%{search}%"
        query = query.filter(
            JobApplication.company_name.ilike(pattern) |
            JobApplication.job_title.ilike(pattern) |
            JobApplication.notes.ilike(pattern)
        )
    return query.order_by(JobApplication.updated_at.desc()).all()

@app.get("/jobs/{job_id}", response_model=JobApplicationResponse)
def get_job(
    job_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    return get_job_or_404(job_id, current_user.id, db)

@app.put("/jobs/{job_id}", response_model=JobApplicationResponse)
def update_job(
    job_id: int,
    job_data: JobApplicationUpdate,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update job application fields. Records timeline event on status change."""
    job = get_job_or_404(job_id, current_user.id, db)
    old_status = job.status
    update_data = job_data.dict(exclude_unset=True)

    # Map position_title → job_title
    if "position_title" in update_data:
        job.job_title = update_data.pop("position_title")

    for field, value in update_data.items():
        setattr(job, field, value)

    job.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(job)

    # Log status change to timeline
    if "status" in update_data and job.status != old_status:
        add_timeline_event(db, job_id, "status_changed",
                           f"Status changed from '{old_status}' to '{job.status}'")
        background_tasks.add_task(
            log_status_change_task, current_user.email,
            job.company_name, job.job_title, job.status
        )

    return job

@app.delete("/jobs/{job_id}")
def delete_job(
    job_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    job = get_job_or_404(job_id, current_user.id, db)
    db.delete(job)
    db.commit()
    return {"message": "Job deleted successfully"}

@app.post("/jobs/{job_id}/archive", response_model=JobApplicationResponse)
def archive_job(
    job_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    job = get_job_or_404(job_id, current_user.id, db)
    job.status = "archived"
    job.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(job)
    add_timeline_event(db, job_id, "status_changed", "Application archived")
    return job

@app.post("/jobs/{job_id}/star", response_model=JobApplicationResponse)
def toggle_star(
    job_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Toggle starred/bookmarked state."""
    job = get_job_or_404(job_id, current_user.id, db)
    job.is_starred = not job.is_starred
    job.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(job)
    return job

# ─── INTERVIEWS ───────────────────────────────────────────────────────────────

@app.post("/jobs/{job_id}/interviews", response_model=InterviewResponse)
def add_interview(
    job_id: int,
    interview_data: InterviewCreate,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Schedule a new interview round for a job application."""
    job = get_job_or_404(job_id, current_user.id, db)

    interview = Interview(
        job_id=job_id,
        round_number=interview_data.round_number,
        interview_type=interview_data.interview_type,
        scheduled_date=interview_data.scheduled_date,
        interviewer_name=interview_data.interviewer_name,
        platform=interview_data.platform,
        duration_minutes=interview_data.duration_minutes,
        status=interview_data.status,
        feedback=interview_data.feedback,
        difficulty_rating=interview_data.difficulty_rating,
        performance_rating=interview_data.performance_rating,
        what_went_well=interview_data.what_went_well,
        improvements=interview_data.improvements,
        follow_up_actions=interview_data.follow_up_actions,
    )
    db.add(interview)

    # Update job status and round number
    if job.status not in ("interview", "offer", "rejected", "withdrawn", "archived"):
        job.status = "interview"
    job.current_interview_round = max(job.current_interview_round or 0, interview_data.round_number)
    job.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(interview)

    # Timeline event
    type_label = interview_data.interview_type.replace("_", " ").title()
    add_timeline_event(db, job_id, "interview_scheduled",
                       f"Round {interview_data.round_number}: {type_label} scheduled")

    # Queue email notifications and general reminders
    background_tasks.add_task(
        send_interview_scheduled_email,
        current_user.email,
        current_user.full_name,
        job.company_name,
        job.job_title,
        interview.round_number,
        interview.scheduled_date,
        interview.platform
    )
    background_tasks.add_task(check_and_send_reminders, current_user.id, lambda: SessionLocal())

    return interview

@app.get("/jobs/{job_id}/interviews", response_model=List[InterviewResponse])
def get_interviews(
    job_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all interview rounds for a job application."""
    get_job_or_404(job_id, current_user.id, db)
    return db.query(Interview).filter(Interview.job_id == job_id).order_by(Interview.round_number).all()

@app.put("/interviews/{interview_id}", response_model=InterviewResponse)
def update_interview(
    interview_id: int,
    interview_data: InterviewUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update an interview round (add feedback, change status, etc.)."""
    interview = db.query(Interview).filter(Interview.id == interview_id).first()
    if not interview:
        raise HTTPException(status_code=404, detail="Interview not found")

    # Verify ownership via job
    get_job_or_404(interview.job_id, current_user.id, db)

    update_data = interview_data.dict(exclude_unset=True)
    for field, value in update_data.items():
        setattr(interview, field, value)

    db.commit()
    db.refresh(interview)

    # Auto-log completion/failure
    if "status" in update_data and update_data["status"] in ("completed", "passed", "failed"):
        add_timeline_event(db, interview.job_id, "interview_completed",
                           f"Round {interview.round_number} marked as '{interview.status}'")
    return interview

@app.delete("/interviews/{interview_id}")
def delete_interview(
    interview_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    interview = db.query(Interview).filter(Interview.id == interview_id).first()
    if not interview:
        raise HTTPException(status_code=404, detail="Interview not found")
    get_job_or_404(interview.job_id, current_user.id, db)
    db.delete(interview)
    db.commit()
    return {"message": "Interview deleted"}

# ─── OFFERS ───────────────────────────────────────────────────────────────────

@app.post("/jobs/{job_id}/offer", response_model=OfferResponse)
def create_offer(
    job_id: int,
    offer_data: OfferCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Record an offer for a job application (also updates job status to 'offer')."""
    job = get_job_or_404(job_id, current_user.id, db)

    # Only one offer per job — delete if exists
    existing = db.query(Offer).filter(Offer.job_id == job_id).first()
    if existing:
        db.delete(existing)
        db.commit()

    offer = Offer(
        job_id=job_id,
        ctc=offer_data.ctc,
        base_salary=offer_data.base_salary,
        bonus_percent=offer_data.bonus_percent,
        stock_options=offer_data.stock_options,
        benefits=offer_data.benefits,
        negotiation_status=offer_data.negotiation_status,
        offer_date=offer_data.offer_date,
        response_deadline=offer_data.response_deadline,
        acceptance_date=offer_data.acceptance_date,
        notes=offer_data.notes,
    )
    db.add(offer)

    # Auto-update job status
    job.status = "offer"
    job.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(offer)

    add_timeline_event(db, job_id, "offer_received",
                       f"Offer received — CTC: {offer_data.ctc}")
    return offer

@app.get("/jobs/{job_id}/offer", response_model=OfferResponse)
def get_offer(
    job_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    get_job_or_404(job_id, current_user.id, db)
    offer = db.query(Offer).filter(Offer.job_id == job_id).first()
    if not offer:
        raise HTTPException(status_code=404, detail="No offer found for this job")
    return offer

@app.put("/jobs/{job_id}/offer", response_model=OfferResponse)
def update_offer(
    job_id: int,
    offer_data: OfferUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    get_job_or_404(job_id, current_user.id, db)
    offer = db.query(Offer).filter(Offer.job_id == job_id).first()
    if not offer:
        raise HTTPException(status_code=404, detail="No offer found for this job")

    update_data = offer_data.dict(exclude_unset=True)
    for field, value in update_data.items():
        setattr(offer, field, value)

    db.commit()
    db.refresh(offer)
    return offer

# ─── TIMELINE ─────────────────────────────────────────────────────────────────

@app.get("/jobs/{job_id}/timeline", response_model=List[TimelineEventResponse])
def get_job_timeline(
    job_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get chronological audit trail for a job application."""
    get_job_or_404(job_id, current_user.id, db)
    return db.query(TimelineEvent).filter(
        TimelineEvent.job_id == job_id
    ).order_by(TimelineEvent.event_date.asc()).all()

# ─── ANALYTICS & STATS ────────────────────────────────────────────────────────

@app.get("/stats")
def get_stats(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Core stats summary."""
    jobs = db.query(JobApplication).filter(JobApplication.user_id == current_user.id).all()

    total = len(jobs)
    applied = sum(1 for j in jobs if j.status == "applied")
    interview = sum(1 for j in jobs if j.status == "interview")
    rejected = sum(1 for j in jobs if j.status == "rejected")
    offered = sum(1 for j in jobs if j.status in ("offer", "offered"))
    withdrawn = sum(1 for j in jobs if j.status == "withdrawn")
    starred = sum(1 for j in jobs if j.is_starred)

    response_rate = round(((total - applied) / total) * 100, 1) if total > 0 else 0.0
    interview_rate = round((interview / total) * 100, 1) if total > 0 else 0.0
    offer_rate = round((offered / (interview + offered) * 100), 1) if (interview + offered) > 0 else 0.0

    return {
        "total_applications": total,
        "response_rate": response_rate,
        "interview_rate": interview_rate,
        "offer_rate": offer_rate,
        "starred": starred,
        "status_breakdown": {
            "applied": applied,
            "interview": interview,
            "offer": offered,
            "rejected": rejected,
            "withdrawn": withdrawn,
        }
    }

@app.get("/stats/funnel")
def get_funnel(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Conversion funnel: Applied → Interview → Offer → Accepted."""
    jobs = db.query(JobApplication).filter(JobApplication.user_id == current_user.id).all()

    total = len(jobs)
    reached_interview = sum(1 for j in jobs if j.status in ("interview", "offer", "rejected", "withdrawn"))
    reached_offer = sum(1 for j in jobs if j.status == "offer")

    # Count accepted offers
    accepted_count = db.query(Offer).join(JobApplication).filter(
        JobApplication.user_id == current_user.id,
        Offer.negotiation_status == "accepted"
    ).count()

    return {
        "stages": [
            {
                "name": "Applied",
                "count": total,
                "rate": 100,
                "color": "#3b82f6"
            },
            {
                "name": "Interview",
                "count": reached_interview,
                "rate": round((reached_interview / total) * 100, 1) if total > 0 else 0,
                "color": "#f59e0b"
            },
            {
                "name": "Offer",
                "count": reached_offer,
                "rate": round((reached_offer / total) * 100, 1) if total > 0 else 0,
                "color": "#10b981"
            },
            {
                "name": "Accepted",
                "count": accepted_count,
                "rate": round((accepted_count / total) * 100, 1) if total > 0 else 0,
                "color": "#6366f1"
            }
        ]
    }

@app.get("/stats/timeline")
def get_timeline_stats(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Applications per day over the last 30 days."""
    thirty_days_ago = datetime.utcnow() - timedelta(days=30)
    jobs = db.query(JobApplication).filter(
        JobApplication.user_id == current_user.id,
        JobApplication.application_date >= thirty_days_ago
    ).all()

    # Build day-by-day counts
    daily: dict = {}
    for job in jobs:
        day_key = job.application_date.strftime("%Y-%m-%d")
        daily[day_key] = daily.get(day_key, 0) + 1

    # Build full 30-day range (fill gaps with 0)
    result = []
    for i in range(30):
        day = (thirty_days_ago + timedelta(days=i + 1)).strftime("%Y-%m-%d")
        result.append({"date": day, "count": daily.get(day, 0)})

    return {"data": result}

@app.get("/stats/upcoming-deadlines")
def get_upcoming_deadlines(
    days: int = 7,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Jobs with deadlines in the next N days."""
    now = datetime.utcnow()
    cutoff = now + timedelta(days=days)

    jobs = db.query(JobApplication).filter(
        JobApplication.user_id == current_user.id,
        JobApplication.deadline_date >= now,
        JobApplication.deadline_date <= cutoff,
        JobApplication.status.notin_(["rejected", "withdrawn", "archived"])
    ).order_by(JobApplication.deadline_date.asc()).all()

    return [
        {
            "id": j.id,
            "company_name": j.company_name,
            "position_title": j.position_title,
            "status": j.status,
            "deadline_date": j.deadline_date.isoformat(),
            "days_left": (j.deadline_date - now).days
        }
        for j in jobs
    ]

@app.get("/stats/interviews")
def get_interview_performance_stats(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Aggregate interview statistics grouped by company and round types."""
    interviews = db.query(Interview).join(JobApplication).filter(
        JobApplication.user_id == current_user.id
    ).all()

    company_stats = {}
    round_type_stats = {}
    improvement_areas = []

    for iv in interviews:
        comp = iv.job.company_name
        # Company grouping
        if comp not in company_stats:
            company_stats[comp] = {
                "company_name": comp,
                "total_rounds": 0,
                "avg_difficulty": 0.0,
                "avg_performance": 0.0,
                "diff_sum": 0,
                "diff_count": 0,
                "perf_sum": 0,
                "perf_count": 0,
                "outcomes": {"completed": 0, "passed": 0, "failed": 0, "scheduled": 0, "cancelled": 0}
            }
        
        c = company_stats[comp]
        c["total_rounds"] += 1
        if iv.difficulty_rating:
            c["diff_sum"] += iv.difficulty_rating
            c["diff_count"] += 1
        if iv.performance_rating:
            c["perf_sum"] += iv.performance_rating
            c["perf_count"] += 1
        if iv.status in c["outcomes"]:
            c["outcomes"][iv.status] += 1
        else:
            c["outcomes"][iv.status] = 1

        # Round type grouping
        rtype = iv.interview_type
        if rtype not in round_type_stats:
            round_type_stats[rtype] = {
                "type": rtype,
                "count": 0,
                "perf_sum": 0,
                "perf_count": 0,
                "diff_sum": 0,
                "diff_count": 0
            }
        rt = round_type_stats[rtype]
        rt["count"] += 1
        if iv.difficulty_rating:
            rt["diff_sum"] += iv.difficulty_rating
            rt["diff_count"] += 1
        if iv.performance_rating:
            rt["perf_sum"] += iv.performance_rating
            rt["perf_count"] += 1

    # Post-process averages
    for c in company_stats.values():
        c["avg_difficulty"] = round(c["diff_sum"] / c["diff_count"], 1) if c["diff_count"] > 0 else 0.0
        c["avg_performance"] = round(c["perf_sum"] / c["perf_count"], 1) if c["perf_count"] > 0 else 0.0
        # Remove helper counts
        del c["diff_sum"], c["diff_count"], c["perf_sum"], c["perf_count"]

    for rt in round_type_stats.values():
        rt["avg_performance"] = round(rt["perf_sum"] / rt["perf_count"], 1) if rt["perf_count"] > 0 else 0.0
        rt["avg_difficulty"] = round(rt["diff_sum"] / rt["diff_count"], 1) if rt["diff_count"] > 0 else 0.0
        
        # Suggest improvement areas if performance is <= 3.2
        if rt["avg_performance"] > 0 and rt["avg_performance"] <= 3.2:
            improvement_areas.append({
                "round_type": rt["type"],
                "reason": f"Average self-performance is low ({rt['avg_performance']}/5) across {rt['count']} round(s).",
                "type_label": rt["type"].replace("_", " ").title()
            })

        del rt["perf_sum"], rt["perf_count"], rt["diff_sum"], rt["diff_count"]

    return {
        "by_company": list(company_stats.values()),
        "by_round_type": list(round_type_stats.values()),
        "improvement_areas": improvement_areas
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)