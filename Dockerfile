FROM python:3.13-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1

COPY manille.py manille_core.py manille_ai.py ./

ENTRYPOINT ["python", "manille.py", "--console"]
CMD ["--auto", "--deals", "3"]
