#!/bin/bash

# SmartVisitor Admin System Deployment Script
# This script helps deploy the SmartVisitor admin system on your VPS

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to check if running as root
check_root() {
    if [[ $EUID -eq 0 ]]; then
        print_warning "Running as root. This is not recommended for security reasons."
        read -p "Continue anyway? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
}

# Function to check prerequisites
check_prerequisites() {
    print_status "Checking prerequisites..."
    
    # Check Docker
    if ! command_exists docker; then
        print_error "Docker is not installed. Please install Docker first."
        exit 1
    fi
    
    # Check Docker Compose
    if ! command_exists docker-compose; then
        print_error "Docker Compose is not installed. Please install Docker Compose first."
        exit 1
    fi
    
    # Check MySQL client
    if ! command_exists mysql; then
        print_warning "MySQL client is not installed. Database setup will be skipped."
        SKIP_DB_SETUP=true
    fi
    
    print_success "Prerequisites check completed"
}

# Function to setup environment
setup_environment() {
    print_status "Setting up environment..."
    
    # Check if .env exists
    if [[ ! -f .env ]]; then
        print_error ".env file not found. Please create it first."
        exit 1
    fi
    
    # Check if MySQL password is set
    if grep -q "your_secure_password_here" .env; then
        print_error "Please update the MySQL password in .env file"
        print_status "Edit .env and replace 'your_secure_password_here' with your actual MySQL password"
        exit 1
    fi
    
    # Check if session secret is set
    if grep -q "your_session_secret_here" .env; then
        print_warning "Session secret not set. Generating random secret..."
        SESSION_SECRET=$(openssl rand -base64 32)
        sed -i "s/your_session_secret_here/$SESSION_SECRET/" .env
        print_success "Session secret generated and updated"
    fi
    
    print_success "Environment setup completed"
}

# Function to setup database
setup_database() {
    if [[ "$SKIP_DB_SETUP" == "true" ]]; then
        print_warning "Skipping database setup (MySQL client not available)"
        return
    fi
    
    print_status "Setting up database..."
    
    # Source environment variables
    source .env
    
    # Test database connection
    print_status "Testing database connection..."
    if mysql -h ${DB_HOST:-172.17.0.1} -u ${DB_USER:-root} -p${MYSQL_ROOT_PASSWORD} -e "USE ${DB_NAME:-sv_scans};" 2>/dev/null; then
        print_success "Database connection successful"
        
        # Run database setup script
        if [[ -f database-setup.sql ]]; then
            print_status "Running database setup script..."
            mysql -h ${DB_HOST:-172.17.0.1} -u ${DB_USER:-root} -p${MYSQL_ROOT_PASSWORD} ${DB_NAME:-sv_scans} < database-setup.sql
            print_success "Database setup completed"
        else
            print_warning "database-setup.sql not found, skipping database setup"
        fi
    else
        print_error "Database connection failed. Please check your database configuration."
        exit 1
    fi
}

# Function to build and start containers
deploy_containers() {
    print_status "Building and starting Docker containers..."
    
    # Stop existing containers
    print_status "Stopping existing containers..."
    docker-compose down 2>/dev/null || true
    
    # Build and start containers
    print_status "Building containers..."
    docker-compose build
    
    print_status "Starting containers..."
    docker-compose up -d
    
    # Wait for containers to start
    print_status "Waiting for containers to start..."
    sleep 10
    
    # Check container status
    if docker-compose ps | grep -q "Up"; then
        print_success "Containers started successfully"
    else
        print_error "Failed to start containers"
        print_status "Container logs:"
        docker-compose logs
        exit 1
    fi
}

# Function to test deployment
test_deployment() {
    print_status "Testing deployment..."
    
    # Test health endpoint
    print_status "Testing health endpoint..."
    for i in {1..30}; do
        if curl -s http://localhost:3000/health >/dev/null 2>&1; then
            print_success "Health endpoint responding"
            break
        fi
        
        if [[ $i -eq 30 ]]; then
            print_error "Health endpoint not responding after 30 attempts"
            print_status "Container logs:"
            docker-compose logs --tail=50
            exit 1
        fi
        
        print_status "Waiting for service to start... (attempt $i/30)"
        sleep 2
    done
    
    # Test API endpoints
    print_status "Testing API endpoints..."
    
    # Test projects endpoint
    if curl -s http://localhost:3000/api/projects >/dev/null 2>&1; then
        print_success "Projects API responding"
    else
        print_warning "Projects API not responding"
    fi
    
    # Test stats endpoint
    if curl -s http://localhost:3000/api/stats >/dev/null 2>&1; then
        print_success "Stats API responding"
    else
        print_warning "Stats API not responding"
    fi
    
    print_success "Deployment test completed"
}

# Function to show deployment info
show_deployment_info() {
    print_success "SmartVisitor Admin System deployed successfully!"
    echo
    print_status "Access Information:"
    echo "  Admin Interface: http://$(hostname -I | awk '{print $1}'):3000"
    echo "  Health Check:    http://$(hostname -I | awk '{print $1}'):3000/health"
    echo
    print_status "Container Status:"
    docker-compose ps
    echo
    print_status "Useful Commands:"
    echo "  View logs:       docker-compose logs -f"
    echo "  Restart:         docker-compose restart"
    echo "  Stop:            docker-compose down"
    echo "  Update:          docker-compose up --build -d"
    echo
    print_status "Next Steps:"
    echo "  1. Update your n8n webhook URL to: http://$(hostname -I | awk '{print $1}'):3000/api/tag-scan"
    echo "  2. Test tag assignment workflow in the admin interface"
    echo "  3. Configure firewall rules if needed"
    echo "  4. Set up SSL/HTTPS with reverse proxy for production"
}

# Main deployment function
main() {
    echo "🏷️  SmartVisitor Admin System Deployment"
    echo "========================================"
    echo
    
    check_root
    check_prerequisites
    setup_environment
    setup_database
    deploy_containers
    test_deployment
    show_deployment_info
    
    print_success "Deployment completed successfully! 🎉"
}

# Run main function
main "$@"
