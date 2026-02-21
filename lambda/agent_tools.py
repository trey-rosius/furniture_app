import boto3
import os
import json
from aws_lambda_powertools import Logger

logger = Logger()

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(os.environ.get('DYNAMODB_TABLE', 'furniture-app-table'))

def get_product_details(product_name: str):
    """
    Search for furniture products by name in the catalog.
    """
    logger.info(f"Searching for product: {product_name}")
    try:
        # Simple scan for demo purposes, in production use GSI or Vector Search
        response = table.scan(
            FilterExpression="contains(productName, :name)",
            ExpressionAttributeValues={":name": product_name}
        )
        return response.get('Items', [])
    except Exception as e:
        logger.error(f"Error searching product: {e}")
        return []

def create_order(product_id: str, quantity: int = 1):
    """
    Create a new furniture order.
    """
    logger.info(f"Creating order for Product ID: {product_id}, Quantity: {quantity}")
    # Mocking order creation
    import uuid
    order_id = str(uuid.uuid4())
    return {
        "status": "success",
        "orderId": order_id,
        "productId": product_id,
        "quantity": quantity,
        "message": "Your order has been placed successfully!"
    }
