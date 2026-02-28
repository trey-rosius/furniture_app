import boto3
import os
import json
import random
import uuid
from decimal import Decimal
from boto3.dynamodb.conditions import Attr
from aws_lambda_powertools import Logger
logger = Logger()

DYNAMODB_TABLE = os.environ.get('DYNAMODB_TABLE', 'furniture-app-table')
dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(DYNAMODB_TABLE)

class DecimalEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, Decimal):
            return float(obj)
        return super(DecimalEncoder, self).default(obj)

def get_all_products():
    """Get all products from the catalog."""
    logger.info("Fetching all products")
    try:
        response = table.scan()
        return response.get('Items', [])
    except Exception as e:
        logger.error(f"Error fetching products: {e}")
        return {"error": str(e)}

def get_products_by_category(category):
    """Get products by category."""
    logger.info(f"Fetching products for category: {category}")
    try:
        response = table.scan(
            FilterExpression=Attr('category').eq(category)
        )
        return response.get('Items', [])
    except Exception as e:
        logger.error(f"Error fetching category products: {e}")
        return {"error": str(e)}

def get_products_by_price_range(min_price, max_price):
    """Get products within a price range."""
    logger.info(f"Fetching products between ${min_price} and ${max_price}")
    try:
        # Note: In production, price should be a number in DynamoDB
        response = table.scan(
            FilterExpression=Attr('price').between(Decimal(str(min_price)), Decimal(str(max_price)))
        )
        return response.get('Items', [])
    except Exception as e:
        logger.error(f"Error fetching price range products: {e}")
        return {"error": str(e)}

def create_order(product_id, quantity=1):
    """Create a new order and save it to DynamoDB."""
    logger.info(f"Creating order for product {product_id}, quantity {quantity}")
    order_id = str(uuid.uuid4())
    
    try:
        # Save to DynamoDB
        table.put_item(
            Item={
                'PK': f"ORDER#{order_id}",
                'SK': f"ORDER#{order_id}",
                'product_id': product_id,
                'quantity': Decimal(str(quantity)),
                'status': 'PENDING',
                'order_id': order_id
            }
        )
        return {
            "status": "SUCCESS",
            "order_id": order_id,
            "message": f"Order for {quantity} item(s) of product {product_id} has been created."
        }
    except Exception as e:
        logger.error(f"Error creating order: {e}")
        return {"error": str(e)}

def get_order(order_id):
    """Get a specific order by ID."""
    logger.info(f"Fetching order: {order_id}")
    try:
        response = table.get_item(
            Key={
                'PK': f"ORDER#{order_id}",
                'SK': f"ORDER#{order_id}"
            }
        )
        return response.get('Item', {"error": "Order not found"})
    except Exception as e:
        logger.error(f"Error fetching order: {e}")
        return {"error": str(e)}

def get_orders():
    """Get all orders."""
    logger.info("Fetching all orders")
    try:
        response = table.scan(
            FilterExpression=Attr('PK').begins_with('ORDER#')
        )
        return response.get('Items', [])
    except Exception as e:
        logger.error(f"Error fetching orders: {e}")
        return {"error": str(e)}


def lambda_handler(event, context):
    # Retrieve the tool name from the context
    try:
        custom_context = context.client_context.custom
        toolName = custom_context.get('bedrockAgentCoreToolName', '')
    except AttributeError:
        # Fallback for manual testing if context is not present
        toolName = event.get('toolName', '')

    logger.info(f"Invoked tool: {toolName}")
    logger.info(f"Event: {json.dumps(event)}")

    # Handle the tool logic
    result = None
    
    # Process toolName to remove any prefix if present
    delimiter = "___"
    if delimiter in toolName:
        toolName = toolName[toolName.index(delimiter) + len(delimiter):]

    if toolName == 'get_all_products':
        result = get_all_products()
    elif toolName == 'get_products_per_category':
        category = event.get('category')
        result = get_products_by_category(category)
    elif toolName == 'get_products_within_price_range':
        min_p = event.get('min_price', 0)
        max_p = event.get('max_price', 1000000)
        result = get_products_by_price_range(min_p, max_p)
    elif toolName == 'create_order':
        prod_id = event.get('product_id')
        qty = event.get('quantity', 1)
        result = create_order(prod_id, qty)
    elif toolName == 'get_order':
        order_id = event.get('order_id')
        result = get_order(order_id)
    elif toolName == 'get_orders':
        result = get_orders()
    else:
        return {
            'statusCode': 400,
            'body': json.dumps({'error': f"Unknown tool: {toolName}"})
        }

    return {
        'statusCode': 200,
        'body': json.dumps(result, cls=DecimalEncoder)
    }
