FROM public.ecr.aws/docker/library/python:3.12-slim

# Create app directory
WORKDIR /app

# print the version just to verify
RUN python3 --version
# start the virtual environment
RUN python3 -m venv /opt/venv

# Enable venv
ENV PATH="/opt/venv/bin:$PATH"

# Install some utilities; you may not need all of these
RUN apt-get update
RUN apt-get install -y git

# Copy the requirements file
COPY requirements*.txt .

# Install app dependencies
# If you use Poetry this step might be different
RUN pip install -r requirements-lock.txt

# Set the directory for nltk data
ENV NLTK_DATA=/opt/nltk_data

# Download punkt data
RUN python -m nltk.downloader -d /opt/nltk_data punkt

# Copy the rest over (including entrypoint script)
# We use a .dockerignore to keep unwanted files exluded
COPY . .

# Make entrypoint script executable
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 8000

# Use entrypoint script that will configure guardrails and install hub validators at runtime
# The GUARDRAILS_TOKEN will be provided as an environment variable from Kubernetes
ENTRYPOINT ["/app/docker-entrypoint.sh"]
