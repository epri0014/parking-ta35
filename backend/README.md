# Create python virtual environment with conda
conda create -n parking-api python=3.11

# Activate
conda activate parking-api

# Install the requirements
pip install -r requirements.txt

# Run the API locally
uvicorn app.main:app --reload --port 8000

