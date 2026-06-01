import boto3, os
from dotenv import load_dotenv
load_dotenv("backend/.env")

account_id = os.getenv("R2_ACCOUNT_ID")
access_key = os.getenv("R2_ACCESS_KEY_ID")
secret_key = os.getenv("R2_SECRET_ACCESS_KEY")
bucket     = os.getenv("R2_BUCKET_NAME")

client = boto3.client(
    "s3",
    endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
    aws_access_key_id=access_key,
    aws_secret_access_key=secret_key,
    region_name="auto",
)

try:
    result = client.list_objects_v2(Bucket=bucket)
    count  = result.get("KeyCount", 0)
    print(f"Conexao OK! Bucket '{bucket}' encontrado. Objetos: {count}")
except Exception as e:
    print(f"ERRO: {e}")
