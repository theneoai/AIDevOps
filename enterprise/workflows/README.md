# Workflow Template Library

## Purpose

This directory stores Dify Workflow export files for version management and reuse. Workflows designed in Dify Studio can be exported to YAML/JSON format, saved here, and committed to Git for version control.

## Directory Structure

```
workflows/
├── marketing/    # Marketing-related workflows
│   └── .gitkeep
├── ops/          # Operations-related workflows
│   └── .gitkeep
└── README.md
```

## Naming Convention

Workflow files should follow this naming pattern:

```
业务域-功能-版本.yml
```

Examples:
- `marketing-wechat-publish-v1.yml`
- `ops-incident-response-v2.yml`
- `marketing-email-campaign-v1.yml`

## Usage

### Export Workflow from Dify Studio

1. Open your workflow in Dify Studio
2. Click the **Export** button
3. Choose **YAML** or **JSON** format
4. Save the file to the appropriate directory with the correct naming convention

### Import Workflow to Dify Studio

1. In Dify Studio, click **Import**
2. Select the YAML/JSON file from this directory
3. Review and adjust any environment-specific settings

## Version Control

- Always commit workflow changes to Git
- Include a brief description of changes in the commit message
- Tag major versions for stable releases

## Best Practices

- Keep workflows modular and reusable
- Document workflow inputs/outputs in comments
- Test workflows in a staging environment before committing
- Remove sensitive data (API keys, tokens) before exporting
