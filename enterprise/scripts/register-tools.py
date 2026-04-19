#!/usr/bin/env python3
"""
Dify 企业自研服务自动注册脚本

此脚本在 Dify 启动后自动注册企业自研的 MCP Server 和 Tool Service，
免除用户手动配置的烦恼。

使用方法:
  python3 register_enterprise_tools.py

环境变量:
  DIFY_DB_HOST: Dify 数据库主机 (默认: db_postgres)
  DIFY_DB_PORT: Dify 数据库端口 (默认: 5432)
  DIFY_DB_USER: Dify 数据库用户 (默认: postgres)
  DIFY_DB_PASSWORD: Dify 数据库密码 (默认: difyai123456)
  DIFY_DB_NAME: Dify 数据库名 (默认: dify)
"""

import os
import sys
import json
import hashlib
import logging
from uuid import uuid4
from datetime import datetime

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# 企业自研服务配置
ENTERPRISE_SERVICES = {
    'mcp-wechat': {
        'name': '微信公众号发布',
        'type': 'mcp',
        'url': 'http://mcp-wechat:3000/sse',
        'identifier': 'mcp-wechat',
        'tools': [
            {
                'name': 'publish_article',
                'description': '发布一篇微信公众号图文文章（创建草稿）',
                'inputSchema': {
                    'type': 'object',
                    'properties': {
                        'title': {'type': 'string', 'description': '文章标题'},
                        'content': {'type': 'string', 'description': '文章正文（支持 HTML 格式）'},
                        'thumb_media_id': {'type': 'string', 'description': '封面图片的 media_id'},
                        'author': {'type': 'string', 'description': '作者名'},
                        'digest': {'type': 'string', 'description': '文章摘要'},
                        'content_source_url': {'type': 'string', 'description': '原文链接'},
                        'need_open_comment': {'type': 'boolean', 'description': '是否打开评论'},
                        'only_fans_can_comment': {'type': 'boolean', 'description': '是否仅粉丝可评论'}
                    },
                    'required': ['title', 'content']
                }
            },
            {
                'name': 'upload_image',
                'description': '上传图片到微信素材库',
                'inputSchema': {
                    'type': 'object',
                    'properties': {
                        'image_url': {'type': 'string', 'description': '图片的 URL 地址'},
                        'type': {'type': 'string', 'enum': ['thumb', 'content'], 'description': '图片类型'}
                    },
                    'required': ['image_url']
                }
            },
            {
                'name': 'get_access_token',
                'description': '获取当前有效的 access_token（调试用）',
                'inputSchema': {
                    'type': 'object',
                    'properties': {}
                }
            }
        ]
    }
}


def get_db_connection():
    """获取数据库连接"""
    try:
        import psycopg2
        conn = psycopg2.connect(
            host=os.getenv('DIFY_DB_HOST', 'db_postgres'),
            port=int(os.getenv('DIFY_DB_PORT', '5432')),
            user=os.getenv('DIFY_DB_USER', 'postgres'),
            password=os.getenv('DIFY_DB_PASSWORD', 'difyai123456'),
            database=os.getenv('DIFY_DB_NAME', 'dify')
        )
        return conn
    except ImportError:
        logger.error("psycopg2 not installed. Install with: pip install psycopg2-binary")
        sys.exit(1)
    except Exception as e:
        logger.error(f"Database connection failed: {e}")
        sys.exit(1)


def get_default_tenant_and_user(conn):
    """获取默认的 tenant_id 和 user_id"""
    cur = conn.cursor()
    
    # 获取第一个 tenant
    cur.execute("SELECT id FROM tenants LIMIT 1")
    tenant_row = cur.fetchone()
    if not tenant_row:
        logger.error("No tenant found in database")
        sys.exit(1)
    tenant_id = tenant_row[0]
    
    # 获取第一个 admin 用户
    cur.execute("SELECT id FROM accounts LIMIT 1")
    user_row = cur.fetchone()
    if not user_row:
        logger.error("No user found in database")
        sys.exit(1)
    user_id = user_row[0]
    
    cur.close()
    return tenant_id, user_id


def register_mcp_provider(conn, tenant_id, user_id, service_config):
    """注册 MCP Provider"""
    cur = conn.cursor()
    
    identifier = service_config['identifier']
    server_url = service_config['url']
    server_url_hash = hashlib.sha256(server_url.encode()).hexdigest()
    
    # 检查是否已存在
    cur.execute(
        "SELECT id FROM tool_mcp_providers WHERE server_identifier = %s AND tenant_id = %s",
        (identifier, tenant_id)
    )
    existing = cur.fetchone()
    
    if existing:
        logger.info(f"MCP provider '{identifier}' already exists (id: {existing[0]})")
        # 更新工具列表
        cur.execute(
            "UPDATE tool_mcp_providers SET tools = %s, updated_at = NOW() WHERE id = %s",
            (json.dumps(service_config['tools']), existing[0])
        )
        conn.commit()
        logger.info(f"Updated MCP provider '{identifier}' tools")
        return existing[0]
    
    # 创建新的 provider
    provider_id = str(uuid4())
    cur.execute('''
        INSERT INTO tool_mcp_providers 
        (id, name, server_identifier, server_url, server_url_hash, tenant_id, user_id, tools, authed)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
    ''', (
        provider_id,
        service_config['name'],
        identifier,
        server_url,
        server_url_hash,
        tenant_id,
        user_id,
        json.dumps(service_config['tools']),
        False
    ))
    
    conn.commit()
    logger.info(f"Created MCP provider '{identifier}' (id: {provider_id})")
    return provider_id


def verify_mcp_connection(conn, provider_id):
    """验证 MCP 连接是否可用"""
    cur = conn.cursor()
    cur.execute(
        "SELECT server_url FROM tool_mcp_providers WHERE id = %s",
        (provider_id,)
    )
    row = cur.fetchone()
    cur.close()
    
    if not row:
        return False
    
    server_url = row[0]
    
    # 简单的 HTTP 健康检查
    try:
        import urllib.request
        health_url = server_url.replace('/sse', '/health')
        req = urllib.request.Request(health_url, method='GET')
        req.add_header('User-Agent', 'Dify-Enterprise-Register/1.0')
        
        try:
            response = urllib.request.urlopen(req, timeout=5)
            if response.status == 200:
                logger.info(f"MCP provider health check passed: {health_url}")
                return True
        except Exception as e:
            logger.warning(f"MCP provider health check failed: {e}")
            return False
    except ImportError:
        logger.warning("urllib not available, skipping health check")
        return True
    
    return False


def register_all_services():
    """注册所有企业自研服务"""
    logger.info("Starting enterprise services registration...")
    
    conn = get_db_connection()
    
    try:
        tenant_id, user_id = get_default_tenant_and_user(conn)
        logger.info(f"Using tenant: {tenant_id}, user: {user_id}")
        
        for service_id, service_config in ENTERPRISE_SERVICES.items():
            logger.info(f"Registering service: {service_id}")
            
            if service_config['type'] == 'mcp':
                provider_id = register_mcp_provider(conn, tenant_id, user_id, service_config)
                verify_mcp_connection(conn, provider_id)
            else:
                logger.warning(f"Unknown service type: {service_config['type']}")
        
        logger.info("Enterprise services registration completed!")
        
    except Exception as e:
        logger.error(f"Registration failed: {e}")
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == '__main__':
    # 等待数据库就绪
    import time
    max_retries = 30
    retry_delay = 2
    
    for i in range(max_retries):
        try:
            conn = get_db_connection()
            conn.close()
            logger.info("Database is ready")
            break
        except Exception as e:
            logger.info(f"Waiting for database... ({i+1}/{max_retries})")
            time.sleep(retry_delay)
    else:
        logger.error("Database not available after max retries")
        sys.exit(1)
    
    # 注册服务
    register_all_services()
