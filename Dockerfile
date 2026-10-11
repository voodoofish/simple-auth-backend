# Use the official lightweight Node.js Alpine Linux image
FROM node:24-alpine

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy dependency architectures first for caching performance
COPY package*.json ./

# Install production-only dependencies
RUN npm ci --omit=dev

# Copy the rest of your application code
COPY . .

# Inform Docker that the container listens on port 3000 at runtime
EXPOSE 2200

# Start the application
CMD ["npm", "dev"]