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
import base64
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
        'icon': 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/wechat/wechat-original.svg',
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
    },
    'mcp-news-aggregator': {
        'name': 'AI 新闻聚合',
        'type': 'mcp',
        'url': 'http://host.docker.internal:3010/sse',
        'identifier': 'mcp-news-aggregator',
        'icon': 'https://cdn.jsdelivr.net/npm/@anthropic-icons/svg/1.0.0/icons/newspaper.svg',
        'tools': [
            {
                'name': 'collect_ai_news',
                'description': '收集最新 AI 科技新闻，支持 Hacker News、OpenAI Blog、Google DeepMind 等 RSS 源',
                'inputSchema': {
                    'type': 'object',
                    'properties': {
                        'maxItems': {'type': 'number', 'description': '最大收集条数 (默认 20)'}
                    }
                }
            },
            {
                'name': 'generate_news_article',
                'description': '根据收集的新闻生成格式化的 AI 周报文章（Markdown 格式）',
                'inputSchema': {
                    'type': 'object',
                    'properties': {
                        'newsData': {'type': 'string', 'description': 'collect_ai_news 返回的 JSON 数据'},
                        'date': {'type': 'string', 'description': '文章日期 (可选，默认当天)'}
                    },
                    'required': ['newsData']
                }
            },
            {
                'name': 'publish_wechat_draft',
                'description': '将文章发布为微信公众号草稿',
                'inputSchema': {
                    'type': 'object',
                    'properties': {
                        'title': {'type': 'string', 'description': '文章标题'},
                        'content': {'type': 'string', 'description': '文章正文 (Markdown)'}
                    },
                    'required': ['title', 'content']
                }
            },
            {
                'name': 'run_full_workflow',
                'description': '运行完整的 AI 新闻聚合工作流：收集新闻 → 生成文章 → 可选发布到微信公众号',
                'inputSchema': {
                    'type': 'object',
                    'properties': {
                        'publishToWeChat': {'type': 'boolean', 'description': '是否发布到微信公众号 (默认 false)'}
                    }
                }
            }
        ]
    },
    'enterprise-tool-service': {
        'name': '企业通用工具服务',
        'type': 'api',
        'url': 'http://enterprise-tool-service:3000/openapi.json',
        'identifier': 'enterprise-tool-service',
        'icon': 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/nodejs/nodejs-original.svg',
        'schema_type': 'openapi',
        'description': '企业自研通用工具服务，提供文本摘要、关键词提取等能力',
    }
}


def get_db_connection():
    """获取数据库连接"""
    try:
        import psycopg2
        conn = psycopg2.connect(
            host=os.getenv('DIFY_DB_HOST', 'localhost'),
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
    cur.execute("SELECT id, encrypt_public_key FROM tenants LIMIT 1")
    tenant_row = cur.fetchone()
    if not tenant_row:
        logger.error("No tenant found in database")
        sys.exit(1)
    tenant_id = tenant_row[0]
    encrypt_public_key = tenant_row[1]
    
    # 获取第一个 admin 用户
    cur.execute("SELECT id FROM accounts LIMIT 1")
    user_row = cur.fetchone()
    if not user_row:
        logger.error("No user found in database")
        sys.exit(1)
    user_id = user_row[0]
    
    cur.close()
    return tenant_id, user_id, encrypt_public_key


def encrypt_server_url(server_url: str, public_key_pem: str) -> str:
    """
    使用 Dify 的混合加密方案加密 server_url
    
    算法:
    1. 生成随机 16-byte AES 密钥
    2. 使用 AES-128-EAX 加密 server_url
    3. 使用 RSA-OAEP (SHA-1) 加密 AES 密钥
    4. 拼接: b"HYBRID:" + rsa_encrypted_aes_key + nonce + tag + ciphertext
    5. Base64 编码
    """
    try:
        from Crypto.Cipher import AES, PKCS1_OAEP
        from Crypto.PublicKey import RSA
        from Crypto.Random import get_random_bytes
        from Crypto.Hash import SHA1
    except ImportError:
        logger.error("pycryptodome not installed. Install with: pip install pycryptodome")
        sys.exit(1)
    
    # 1. AES 加密
    aes_key = get_random_bytes(16)
    cipher_aes = AES.new(aes_key, AES.MODE_EAX)
    ciphertext, tag = cipher_aes.encrypt_and_digest(server_url.encode())
    
    # 2. RSA 加密 AES 密钥
    rsa_key = RSA.import_key(public_key_pem)
    cipher_rsa = PKCS1_OAEP.new(rsa_key, hashAlgo=SHA1)
    enc_aes_key = cipher_rsa.encrypt(aes_key)
    
    # 3. 构建混合载荷
    prefix = b"HYBRID:"
    payload = prefix + enc_aes_key + cipher_aes.nonce + tag + ciphertext
    
    # 4. Base64 编码
    return base64.b64encode(payload).decode()


def register_mcp_provider(conn, tenant_id, user_id, encrypt_public_key, service_config):
    """注册 MCP Provider"""
    cur = conn.cursor()
    
    identifier = service_config['identifier']
    server_url = service_config['url']
    server_url_hash = hashlib.sha256(server_url.encode()).hexdigest()
    
    # 加密 server_url
    if encrypt_public_key:
        try:
            encrypted_server_url = encrypt_server_url(server_url, encrypt_public_key)
            logger.info(f"Encrypted server_url for '{identifier}'")
        except Exception as e:
            logger.error(f"Failed to encrypt server_url: {e}")
            # 如果没有公钥或加密失败，回退到明文存储（不推荐用于生产环境）
            encrypted_server_url = server_url
            logger.warning(f"Storing server_url in plaintext for '{identifier}' (not recommended for production)")
    else:
        logger.warning(f"No encrypt_public_key found for tenant {tenant_id}, storing server_url in plaintext")
        encrypted_server_url = server_url
    
    # 检查是否已存在
    cur.execute(
        "SELECT id FROM tool_mcp_providers WHERE server_identifier = %s AND tenant_id = %s",
        (identifier, tenant_id)
    )
    existing = cur.fetchone()
    
    if existing:
        logger.info(f"MCP provider '{identifier}' already exists (id: {existing[0]})")
        # 更新工具列表和 server_url
        cur.execute(
            "UPDATE tool_mcp_providers SET tools = %s, server_url = %s, server_url_hash = %s, icon = %s, updated_at = NOW() WHERE id = %s",
            (json.dumps(service_config['tools']), encrypted_server_url, server_url_hash, service_config.get('icon', 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/wechat/wechat-original.svg'), existing[0])
        )
        conn.commit()
        logger.info(f"Updated MCP provider '{identifier}'")
        return existing[0]
    
    # 创建新的 provider
    provider_id = str(uuid4())
    cur.execute('''
        INSERT INTO tool_mcp_providers 
        (id, name, server_identifier, server_url, server_url_hash, tenant_id, user_id, tools, authed, icon)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
    ''', (
        provider_id,
        service_config['name'],
        identifier,
        encrypted_server_url,
        server_url_hash,
        tenant_id,
        user_id,
        json.dumps(service_config['tools']),
        False,
        service_config.get('icon', 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/wechat/wechat-original.svg')
    ))
    
    conn.commit()
    logger.info(f"Created MCP provider '{identifier}' (id: {provider_id})")
    return provider_id


def register_api_provider(conn, tenant_id, user_id, service_config):
    """注册 API Tool Provider"""
    cur = conn.cursor()
    
    identifier = service_config['identifier']
    name = service_config['name']
    schema_url = service_config['url']
    
    # 获取 OpenAPI schema
    try:
        import urllib.request
        req = urllib.request.Request(schema_url, method='GET')
        req.add_header('User-Agent', 'Dify-Enterprise-Register/1.0')
        response = urllib.request.urlopen(req, timeout=10)
        schema_content = response.read().decode('utf-8')
        logger.info(f"Fetched OpenAPI schema from {schema_url} ({len(schema_content)} bytes)")
    except Exception as e:
        logger.error(f"Failed to fetch OpenAPI schema from {schema_url}: {e}")
        return None
    
    # 检查是否已存在
    cur.execute(
        "SELECT id FROM tool_api_providers WHERE name = %s AND tenant_id = %s",
        (identifier, tenant_id)
    )
    existing = cur.fetchone()
    
    # 构建 tools_str，必须符合 Dify 的 ApiToolBundle 格式
    tools_str = json.dumps([
        {
            'server_url': service_config['url'].replace('/openapi.json', ''),
            'method': 'post',
            'summary': '文本摘要生成',
            'operation_id': 'summarize',
            'author': 'enterprise',
            'parameters': [
                {
                    'name': 'text',
                    'label': {'en_US': 'Text', 'zh_Hans': '文本'},
                    'type': 'string',
                    'form': 'llm',
                    'llm_description': '需要摘要的文本内容',
                    'required': True,
                    'placeholder': {'en_US': 'Enter text to summarize', 'zh_Hans': '输入需要摘要的文本'}
                },
                {
                    'name': 'max_length',
                    'label': {'en_US': 'Max Length', 'zh_Hans': '最大长度'},
                    'type': 'number',
                    'form': 'llm',
                    'llm_description': '摘要的最大长度',
                    'required': False,
                    'default': 100
                }
            ],
            'openapi': {
                'operationId': 'summarize',
                'summary': '文本摘要生成',
                'requestBody': {
                    'content': {
                        'application/json': {
                            'schema': {
                                'type': 'object',
                                'properties': {
                                    'text': {'type': 'string', 'description': '需要摘要的文本'},
                                    'max_length': {'type': 'integer', 'description': '最大长度'}
                                },
                                'required': ['text']
                            }
                        }
                    }
                }
            }
        },
        {
            'server_url': service_config['url'].replace('/openapi.json', ''),
            'method': 'post',
            'summary': '关键词提取',
            'operation_id': 'extract_keywords',
            'author': 'enterprise',
            'parameters': [
                {
                    'name': 'text',
                    'label': {'en_US': 'Text', 'zh_Hans': '文本'},
                    'type': 'string',
                    'form': 'llm',
                    'llm_description': '需要提取关键词的文本内容',
                    'required': True,
                    'placeholder': {'en_US': 'Enter text to extract keywords', 'zh_Hans': '输入需要提取关键词的文本'}
                },
                {
                    'name': 'count',
                    'label': {'en_US': 'Count', 'zh_Hans': '数量'},
                    'type': 'number',
                    'form': 'llm',
                    'llm_description': '提取的关键词数量',
                    'required': False,
                    'default': 5
                }
            ],
            'openapi': {
                'operationId': 'extract_keywords',
                'summary': '关键词提取',
                'requestBody': {
                    'content': {
                        'application/json': {
                            'schema': {
                                'type': 'object',
                                'properties': {
                                    'text': {'type': 'string', 'description': '需要提取关键词的文本'},
                                    'count': {'type': 'integer', 'description': '关键词数量'}
                                },
                                'required': ['text']
                            }
                        }
                    }
                }
            }
        }
    ])
    
    # 加密凭证（空凭证）
    credentials = json.dumps({"auth_type": "none"})
    
    if existing:
        logger.info(f"API provider '{identifier}' already exists (id: {existing[0]})")
        # 更新 schema
        cur.execute(
            "UPDATE tool_api_providers SET schema = %s, tools_str = %s, updated_at = NOW() WHERE id = %s",
            (schema_content, tools_str, existing[0])
        )
        conn.commit()
        logger.info(f"Updated API provider '{identifier}'")
        return existing[0]
    
    # 创建新的 provider
    provider_id = str(uuid4())
    cur.execute('''
        INSERT INTO tool_api_providers 
        (id, name, icon, schema, schema_type_str, user_id, tenant_id, description, tools_str, credentials_str, privacy_policy, custom_disclaimer)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
    ''', (
        provider_id,
        identifier,
        service_config.get('icon', ''),
        schema_content,
        service_config.get('schema_type', 'openapi'),
        user_id,
        tenant_id,
        service_config.get('description', ''),
        tools_str,
        credentials,
        '',
        ''
    ))
    
    conn.commit()
    logger.info(f"Created API provider '{identifier}' (id: {provider_id})")
    return provider_id


def verify_mcp_connection(server_url):
    """验证 MCP 连接是否可用"""
    
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
        tenant_id, user_id, encrypt_public_key = get_default_tenant_and_user(conn)
        logger.info(f"Using tenant: {tenant_id}, user: {user_id}")
        
        if encrypt_public_key:
            logger.info(f"Found encrypt_public_key for tenant (length: {len(encrypt_public_key)})")
        else:
            logger.warning("No encrypt_public_key found for tenant")
        
        for service_id, service_config in ENTERPRISE_SERVICES.items():
            logger.info(f"Registering service: {service_id}")
            
            if service_config['type'] == 'mcp':
                provider_id = register_mcp_provider(conn, tenant_id, user_id, encrypt_public_key, service_config)
                verify_mcp_connection(service_config['url'])
            elif service_config['type'] == 'api':
                provider_id = register_api_provider(conn, tenant_id, user_id, service_config)
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
