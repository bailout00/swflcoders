# Integration Tests

This package contains integration tests for the SWFLCoders chat application.

## Overview

The integration tests verify that the chat API works end-to-end by:

1. Sending a message via the REST API
2. Verifying the message is stored in DynamoDB
3. Cleaning up the test data by deleting the message

## Running Tests

### Local Development

**Note:** Integration tests require AWS credentials and a running backend API.

```bash
# Install dependencies
yarn install

# Source environment variables (or set them manually)
source ./dev.sh

# Set AWS credentials (choose one option):
# Option 1: Set access keys directly
export AWS_ACCESS_KEY_ID=your-access-key
export AWS_SECRET_ACCESS_KEY=your-secret-key

# Option 2: Use AWS profile (recommended)
export AWS_PROFILE=your-profile-name

# Ensure backend is running
# In another terminal: yarn workspace @swflcoders/backend run dev

# Run tests
yarn test
```

Or manually set the variables:

```bash
export TEST_BASE_URL=http://localhost:3001
export TEST_TARGET_STAGE=dev
export AWS_DEFAULT_REGION=us-east-1

# Choose one authentication method:
# Option 1: Access keys
export AWS_ACCESS_KEY_ID=your-access-key
export AWS_SECRET_ACCESS_KEY=your-secret-key

# Option 2: AWS profile (recommended)
export AWS_PROFILE=your-profile-name
```

### In AWS CodePipeline

The integration tests are automatically run as part of the deployment pipeline:

```bash
# Run via workspace
yarn pipeline:test:integ
```

The pipeline sets the following environment variables:

- `TEST_BASE_URL`: The base URL of the deployed API (e.g., `https://api.beta.swflcoders.com`)
- `TEST_TARGET_STAGE`: The deployment stage (e.g., `beta`, `gamma`, `prod`)
- `AWS_DEFAULT_REGION`: AWS region for DynamoDB access

## Test Configuration

The tests use the following configuration:

- **API Endpoint**: `POST /chat/messages`
- **DynamoDB Table**: `chat-messages-{stage}` (e.g., `chat-messages-beta`)
- **Test Room**: `general`
- **Test User**: Auto-generated with unique ID

## AWS Permissions Required

The integration tests require the following AWS permissions:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "dynamodb:Query",
                "dynamodb:DeleteItem"
            ],
            "Resource": "arn:aws:dynamodb:*:*:table/chat-messages-*"
        }
    ]
}
```

## Test Flow

1. **Send Message**: POST request to `/chat/messages` with test data
2. **Verify Storage**: Query DynamoDB to confirm message exists
3. **Cleanup**: Delete the test message from DynamoDB
4. **Report**: Exit with success/failure status

## Troubleshooting

### Common Issues

1. **API Connection Failed**: Check `TEST_BASE_URL` and network connectivity
2. **DynamoDB Access Denied**: Verify AWS credentials and permissions
3. **Message Not Found**: Check table name and query parameters

### Debug Mode

Add debug logging by setting environment variables:

```bash
DEBUG=1 yarn test
```

### Local Testing

For local development, ensure the backend is running:

```bash
# Start backend
yarn workspace @swflcoders/backend run dev

# Set environment variables
export TEST_BASE_URL=http://localhost:3001
export TEST_TARGET_STAGE=dev
export AWS_DEFAULT_REGION=us-east-1

# Run tests
yarn test
```
