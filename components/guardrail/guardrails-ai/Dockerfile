FROM public.ecr.aws/docker/library/python:3.12-slim

# Accept a build arg for the Guardrails token
# We'll add this to the config using the configure command below
ARG GUARDRAILS_TOKEN

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

# Run the Guardrails configure command to create a .guardrailsrc file
RUN guardrails configure --disable-metrics --enable-remote-inferencing  --token $GUARDRAILS_TOKEN

# Install any validators from the hub you want
RUN guardrails hub install hub://guardrails/detect_pii

# Copy the rest over
# We use a .dockerignore to keep unwanted files exluded
COPY . .

EXPOSE 8000

# This is our start command; yours might be different.
# The guardrails-api is a standard Flask application.
# You can use whatever production server you want that support Flask.
# Here we use gunicorn
CMD gunicorn --bind 0.0.0.0:8000 --timeout=90 --workers=4 'guardrails_api.app:create_app(None, "config.py")'