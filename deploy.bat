@echo off
REM SmartVisitor Admin System Deployment Script for Windows
REM This script helps deploy the SmartVisitor admin system

setlocal enabledelayedexpansion

echo.
echo 🏷️  SmartVisitor Admin System Deployment
echo ========================================
echo.

REM Check if Docker is installed
docker --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker is not installed or not in PATH
    echo Please install Docker Desktop first
    pause
    exit /b 1
)

REM Check if Docker Compose is available
docker-compose --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker Compose is not available
    echo Please ensure Docker Desktop is running
    pause
    exit /b 1
)

echo [INFO] Docker and Docker Compose are available

REM Check if .env file exists
if not exist ".env" (
    echo [ERROR] .env file not found
    echo Please create the .env file first
    pause
    exit /b 1
)

REM Check if MySQL password is configured
findstr /C:"your_secure_password_here" .env >nul
if not errorlevel 1 (
    echo [ERROR] Please update the MySQL password in .env file
    echo Edit .env and replace 'your_secure_password_here' with your actual MySQL password
    pause
    exit /b 1
)

echo [INFO] Environment configuration looks good

REM Stop existing containers
echo [INFO] Stopping existing containers...
docker-compose down 2>nul

REM Build and start containers
echo [INFO] Building Docker containers...
docker-compose build
if errorlevel 1 (
    echo [ERROR] Failed to build containers
    pause
    exit /b 1
)

echo [INFO] Starting containers...
docker-compose up -d
if errorlevel 1 (
    echo [ERROR] Failed to start containers
    pause
    exit /b 1
)

REM Wait for containers to start
echo [INFO] Waiting for containers to start...
timeout /t 10 /nobreak >nul

REM Test health endpoint
echo [INFO] Testing health endpoint...
set /a attempts=0
:healthcheck
set /a attempts+=1
curl -s http://localhost:3000/health >nul 2>&1
if not errorlevel 1 (
    echo [SUCCESS] Health endpoint responding
    goto :healthcheck_success
)

if !attempts! geq 30 (
    echo [ERROR] Health endpoint not responding after 30 attempts
    echo [INFO] Container logs:
    docker-compose logs --tail=50
    pause
    exit /b 1
)

echo [INFO] Waiting for service to start... (attempt !attempts!/30)
timeout /t 2 /nobreak >nul
goto :healthcheck

:healthcheck_success

REM Show container status
echo [INFO] Container status:
docker-compose ps

REM Get local IP address
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /C:"IPv4 Address"') do (
    set "ip=%%a"
    set "ip=!ip: =!"
    goto :ip_found
)
set "ip=localhost"

:ip_found

echo.
echo [SUCCESS] SmartVisitor Admin System deployed successfully! 🎉
echo.
echo Access Information:
echo   Admin Interface: http://!ip!:3000
echo   Health Check:    http://!ip!:3000/health
echo.
echo Useful Commands:
echo   View logs:       docker-compose logs -f
echo   Restart:         docker-compose restart
echo   Stop:            docker-compose down
echo   Update:          docker-compose up --build -d
echo.
echo Next Steps:
echo   1. Update your n8n webhook URL to: http://!ip!:3000/api/tag-scan
echo   2. Test tag assignment workflow in the admin interface
echo   3. Configure firewall rules if needed
echo.

pause
