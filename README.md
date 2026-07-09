# Applync - Job Application Tracker

A full-stack web application for managing and tracking job applications with real-time statistics and filtering capabilities.

## 🚀 Live Demo
[https://applync-frontend.vercel.app](https://applync-frontend.vercel.app)

## 📋 Features
- **User Authentication**: Secure JWT-based registration and login with bcrypt password hashing
- **Job Application Management**: Create, read, update, delete job applications
- **Real-time Statistics**: Dashboard displays application counts by status
- **Filtering & Sorting**: Filter applications by status (Applied, Interview, Offer, Rejected, Withdrawn)
- **Responsive Design**: Mobile-friendly interface with modern CSS styling
- **RESTful API**: 8+ endpoints with proper error handling and validation

## 🛠️ Tech Stack
### Frontend
- React 18 with Vite
- Axios for API calls
- React Router for navigation
- Modern CSS3 with responsive design

### Backend
- FastAPI framework
- SQLAlchemy ORM
- PostgreSQL database
- JWT authentication (supporting Bearer tokens in headers or query parameters)

### Deployment
- Backend: Render
- Frontend: Vercel
- CI/CD: GitHub integration

## 📁 Project Structure
```
applync/
├── backend/
│   ├── main.py              # FastAPI application
│   ├── requirements.txt      # Python dependencies
│   └── .env                  # Environment variables
├── frontend/
│   ├── src/
│   │   ├── App.jsx          # Main React component
│   │   ├── App.css          # Styling
│   │   └── main.jsx         # Entry point
│   └── package.json         # Node dependencies
└── README.md
```

## 🔐 Authentication Flow
1. User registers with email and password.
2. Password hashed with bcrypt on backend.
3. Server returns JWT token and user info.
4. Token stored in localStorage on the client.
5. Token sent automatically in the `Authorization: Bearer <token>` header with each API request.
6. Server validates token and returns user-specific data, isolating user records.

## 📊 Database Schema
### Users Table
- `id` (primary key)
- `email` (unique)
- `name` (maps to `full_name` in frontend)
- `password_hash`
- `created_at`

### Job Applications Table
- `id` (primary key)
- `user_id` (foreign key)
- `company_name`
- `job_title` (maps to `position_title` in frontend)
- `job_url` (optional)
- `application_date`
- `status` (applied, interview, offer, rejected, withdrawn)
- `notes` (optional)
- `created_at`, `updated_at`

## 🔌 API Endpoints
### Authentication
- POST `/auth/register` - Register new user
- POST `/auth/login` - Login user
- GET `/auth/me` - Get current user profile

### Jobs
- POST `/jobs` - Create job application
- GET `/jobs` - Get all applications
- GET `/jobs/{job_id}` - Get single application
- PUT `/jobs/{job_id}` - Update application
- DELETE `/jobs/{job_id}` - Delete application

### Analytics
- GET `/stats` - Get application statistics

## 🚀 Getting Started

### Prerequisites
- Python 3.11+
- Node.js 18+
- PostgreSQL 12+

### Backend Setup
```bash
cd backend
python -m pip install -r requirements.txt
# Create .env file with DATABASE_URL
uvicorn main:app --reload
```

### Frontend Setup
```bash
cd frontend
npm install
npm run dev
```

Visit [http://localhost:5173](http://localhost:5173)

## 📝 License
Open source - feel free to fork and modify.

## 👨💻 Author
Built as a full-stack learning project.
