#!/bin/bash

# SmartVisitor Health Check Script
# This script checks the health of the SmartVisitor admin system

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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

echo "🏷️  SmartVisitor Health Check"
echo "============================"
echo

# Check Docker containers
print_status "Checking Docker containers..."
if docker-compose ps | grep -q "Up"; then
    print_success "Containers are running"
    docker-compose ps
else
    print_error "Containers are not running"
    print_status "Starting containers..."
    docker-compose up -d
fi

echo

# Check health endpoint
print_status "Checking health endpoint..."
if curl -s http://localhost:3000/health >/dev/null 2>&1; then
    print_success "Health endpoint responding"
    echo "Response:"
    curl -s http://localhost:3000/health | jq . 2>/dev/null || curl -s http://localhost:3000/health
else
    print_error "Health endpoint not responding"
fi

echo

# Check API endpoints
print_status "Checking API endpoints..."

# Projects endpoint
if curl -s http://localhost:3000/api/projects >/dev/null 2>&1; then
    print_success "Projects API responding"
else
    print_warning "Projects API not responding"
fi

# Stats endpoint
if curl -s http://localhost:3000/api/stats >/dev/null 2>&1; then
    print_success "Stats API responding"
    echo "Stats:"
    curl -s http://localhost:3000/api/stats | jq . 2>/dev/null || curl -s http://localhost:3000/api/stats
else
    print_warning "Stats API not responding"
fi

echo

# Check logs for errors
print_status "Checking recent logs for errors..."
if docker-compose logs --tail=20 smartvisitor-admin | grep -i error; then
    print_warning "Errors found in logs"
else
    print_success "No recent errors in logs"
fi

echo

# Show resource usage
print_status "Container resource usage:"
docker stats --no-stream smartvisitor-admin 2>/dev/null || print_warning "Could not get container stats"

echo

# Show disk usage
print_status "Disk usage:"
du -sh . 2>/dev/null || print_warning "Could not get disk usage"

echo

print_status "Health check completed"
