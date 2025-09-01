#!/usr/bin/env node

import axios from 'axios'
import { DynamoDB } from 'aws-sdk'
import { v4 as uuidv4 } from 'uuid'

// Types from the shared types package
interface SendMessageRequest {
    room_id: string
    user_id: string
    username: string
    message_text: string
    client_message_id: string | null
}

interface ChatMessage {
    id: string
    room_id: string
    userId: string
    username: string
    message_text: string
    created_at: string
    clientMessageId: string | null
}

interface Message {
    id: string
    userId: string
    username: string
    text: string
    timestamp: string
}

// Test configuration from environment
const TEST_BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3001'
const TEST_TARGET_STAGE = process.env.TEST_TARGET_STAGE || 'dev'
const AWS_REGION = process.env.AWS_DEFAULT_REGION || 'us-east-1'

// DynamoDB table names
const CHAT_MESSAGES_TABLE = 'chat-messages'

// Test user data
const TEST_USER = {
    userId: `test-user-${uuidv4()}`,
    username: 'IntegrationTestUser',
}

const ROOM_ID = 'general'

// Initialize AWS SDK
const dynamodb = new DynamoDB.DocumentClient({
    region: AWS_REGION,
})

async function sendMessage(messageText: string): Promise<Message> {
    const request: SendMessageRequest = {
        room_id: ROOM_ID,
        user_id: TEST_USER.userId,
        username: TEST_USER.username,
        message_text: messageText,
        client_message_id: uuidv4(),
    }

    console.log('📤 Sending message:', request)

    try {
        const response = await axios.post(`${TEST_BASE_URL}/chat/messages`, request, {
            headers: {
                'Content-Type': 'application/json',
            },
            timeout: 10000,
        })

        console.log('Raw API response:', JSON.stringify(response.data, null, 2))

        // Check if response is wrapped in ApiResponse format
        if (response.data.success !== undefined) {
            // ApiResponse format
            if (!response.data.success || !response.data.data) {
                throw new Error(`API returned error: ${response.data.error || 'Unknown error'}`)
            }
            console.log('✅ Message sent successfully (ApiResponse format):', response.data.data)
            return response.data.data
        } else {
            // Direct ChatMessage format - convert to Message format
            const chatMessage: ChatMessage = response.data
            console.log('✅ Message sent successfully (direct format):', chatMessage)

            // Convert ChatMessage to Message format
            const message: Message = {
                id: chatMessage.id,
                userId: chatMessage.userId,
                username: chatMessage.username,
                text: chatMessage.message_text,
                timestamp: chatMessage.created_at,
            }
            return message
        }
    } catch (error) {
        console.error('❌ Failed to send message:', error)
        throw error
    }
}

async function verifyMessageInDynamoDB(message: Message): Promise<boolean> {
    console.log('🔍 Verifying message in DynamoDB:', message.id)

    try {
        // Query messages by room_id (partition key)
        const params = {
            TableName: CHAT_MESSAGES_TABLE,
            KeyConditionExpression: 'room_id = :roomId',
            ExpressionAttributeValues: {
                ':roomId': ROOM_ID,
            },
            ScanIndexForward: false, // Get latest messages first
            Limit: 10,
        }

        const result = await dynamodb.query(params).promise()

        if (!result.Items || result.Items.length === 0) {
            console.error('❌ No messages found in DynamoDB')
            return false
        }

        // Find our message in the results
        const foundMessage = result.Items.find((item: Record<string, unknown>) => {
            const id = item.id
            return typeof id === 'string' && id === message.id
        })

        if (!foundMessage) {
            console.error('❌ Message not found in DynamoDB results')
            return false
        }

        console.log('✅ Message verified in DynamoDB:', foundMessage)
        return true
    } catch (error) {
        console.error('❌ Failed to verify message in DynamoDB:', error)
        throw error
    }
}

async function deleteMessageFromDynamoDB(message: Message): Promise<void> {
    console.log('🗑️  Deleting message from DynamoDB:', message.id)

    try {
        // First, we need to find the exact item with both partition key and sort key
        const queryParams = {
            TableName: CHAT_MESSAGES_TABLE,
            KeyConditionExpression: 'room_id = :roomId',
            FilterExpression: 'id = :messageId',
            ExpressionAttributeValues: {
                ':roomId': ROOM_ID,
                ':messageId': message.id,
            },
        }

        const queryResult = await dynamodb.query(queryParams).promise()

        if (!queryResult.Items || queryResult.Items.length === 0) {
            throw new Error('Message not found for deletion')
        }

        const itemToDelete = queryResult.Items[0]
        const deleteParams = {
            TableName: CHAT_MESSAGES_TABLE,
            Key: {
                room_id: itemToDelete.room_id,
                ts: itemToDelete.ts,
            },
        }

        await dynamodb.delete(deleteParams).promise()
        console.log('✅ Message deleted from DynamoDB')
    } catch (error) {
        console.error('❌ Failed to delete message from DynamoDB:', error)
        throw error
    }
}

async function runIntegrationTest(): Promise<void> {
    console.log('🚀 Starting chat integration test')
    console.log(`📍 Test Base URL: ${TEST_BASE_URL}`)
    console.log(`🏷️  Test Stage: ${TEST_TARGET_STAGE}`)
    console.log(`🌍 AWS Region: ${AWS_REGION}`)

    try {
        // Step 1: Send a message
        const testMessage = `Integration test message - ${new Date().toISOString()}`
        const sentMessage = await sendMessage(testMessage)

        // Step 2: Verify message was stored in DynamoDB
        const messageExists = await verifyMessageInDynamoDB(sentMessage)
        if (!messageExists) {
            throw new Error('Message was not properly stored in DynamoDB')
        }

        // Step 3: Clean up - delete the test message
        await deleteMessageFromDynamoDB(sentMessage)

        console.log('🎉 Integration test completed successfully!')
        process.exit(0)
    } catch (error) {
        console.error('💥 Integration test failed:', error)
        process.exit(1)
    }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason)
    process.exit(1)
})

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error)
    process.exit(1)
})

// Run the test
runIntegrationTest()
