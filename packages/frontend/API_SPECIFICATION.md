# Chat API Specification

This document describes the expected API endpoints and payloads for the chat backend implementation.

## Overview

The frontend uses React Query for state management and expects REST API endpoints with optimistic updates. Each message has a unique ULID identifier and each user has a persistent ULID for ownership tracking.

## Data Types

### Message Object
```typescript
interface Message {
  id: string           // ULID - unique message identifier
  userId: string       // ULID - sender's unique identifier
  username: string     // Display name of the sender
  text: string         // Message content
  timestamp: Date      // When the message was sent (ISO 8601 string over wire)
  isOwnMessage?: boolean // Optional - computed by frontend for UI
}
```

### User Identification
```typescript
interface User {
  userId: string       // ULID - persistent across sessions
  username: string     // Display name chosen by user
}
```

## API Endpoints

### 1. Get Messages
**GET** `/api/messages`

Retrieves all chat messages, typically paginated in a real implementation.

**Request:**
```http
GET /api/messages
```

**Response:**
```json
{
  "success": true,
  "messages": [
    {
      "id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      "userId": "01ARZ3NDEKTSV4RRFFQ69G5FB1", 
      "username": "Alice",
      "text": "Hello everyone!",
      "timestamp": "2025-08-23T19:20:00.000Z"
    },
    {
      "id": "01ARZ3NDEKTSV4RRFFQ69G5FB2",
      "userId": "01ARZ3NDEKTSV4RRFFQ69G5FB3",
      "username": "Bob", 
      "text": "Hi Alice!",
      "timestamp": "2025-08-23T19:21:30.000Z"
    }
  ]
}
```

**Error Response:**
```json
{
  "success": false,
  "error": "Failed to fetch messages"
}
```

### 2. Send Message
**POST** `/api/messages`

Sends a new message to the chat.

**Request:**
```json
{
  "userId": "01ARZ3NDEKTSV4RRFFQ69G5FB1",
  "username": "Alice",
  "text": "This is my message"
}
```

**Response:**
```json
{
  "success": true,
  "message": {
    "id": "01ARZ3NDEKTSV4RRFFQ69G5FB4",
    "userId": "01ARZ3NDEKTSV4RRFFQ69G5FB1",
    "username": "Alice", 
    "text": "This is my message",
    "timestamp": "2025-08-23T19:22:00.000Z"
  }
}
```

**Error Response:**
```json
{
  "success": false,
  "error": "Message text is required"
}
```

**Validation Rules:**
- `userId`: Required, must be valid ULID format
- `username`: Required, 2-255 characters
- `text`: Required, 1-1000 characters (adjust as needed)

## Frontend Behavior

### Message Deduplication
The frontend implements message deduplication by `id`. When the same message appears multiple times (e.g., from optimistic updates and then server broadcast), only one copy is kept.

### Message Ownership
Messages are marked as "own messages" when `message.userId === currentUser.userId`. This is computed on the frontend for UI styling.

### Optimistic Updates
When a user sends a message:
1. **Frontend immediately shows the message** in the UI
2. **API call is made** to POST `/api/messages`
3. **Server response** is merged with existing messages (deduplicating by ID)
4. **Real-time updates** (if implemented) will not duplicate the message

### Polling vs Real-time
Currently, the frontend polls `/api/messages` every 3 seconds. For better UX, consider implementing:
- **WebSocket connections** for real-time message delivery
- **Server-Sent Events (SSE)** for one-way message broadcasting
- **Webhook notifications** to trigger frontend refetches

## User Identification Flow

### User Session Management
The frontend generates and persists a ULID `userId` when a user first sets their username. This `userId`:
- **Persists across browser sessions** (stored in React Native AsyncStorage/localStorage)
- **Remains constant** for the same user on the same device
- **Should be treated as the primary user identifier** by the backend

### Username Changes
If users can change usernames, the `userId` remains constant while `username` changes. Consider:
- **User profile endpoint** for username updates
- **Message history preservation** using the stable `userId`

## Error Handling

### Expected HTTP Status Codes
- **200**: Success
- **400**: Bad request (validation errors)
- **401**: Unauthorized (if auth is added later)
- **429**: Rate limiting
- **500**: Server error

### Error Response Format
All error responses should follow this format:
```json
{
  "success": false,
  "error": "Human-readable error message",
  "code": "OPTIONAL_ERROR_CODE"
}
```

## Rate Limiting Considerations

The frontend currently:
- **Polls every 3 seconds** for new messages
- **Sends messages on user action** (not automated)

Consider implementing:
- **Rate limits per userId** (e.g., 10 messages per minute)
- **Throttling for polling** (e.g., max 1 request per second per user)

## Database Considerations

### Recommended Schema
```sql
CREATE TABLE messages (
    id VARCHAR(26) PRIMARY KEY,        -- ULID
    user_id VARCHAR(26) NOT NULL,      -- ULID  
    username VARCHAR(255) NOT NULL,
    text TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_messages_created_at ON messages(created_at DESC);
CREATE INDEX idx_messages_user_id ON messages(user_id);
```

### Data Integrity
- Use **ULID generation** on the server side for message IDs
- **Validate userId format** (26-character ULID)
- **Store timestamps in UTC** and convert for display

## Testing the API

### Sample cURL Commands

**Get Messages:**
```bash
curl -X GET http://localhost:3000/api/messages
```

**Send Message:**
```bash
curl -X POST http://localhost:3000/api/messages \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "01ARZ3NDEKTSV4RRFFQ69G5FB1",
    "username": "TestUser",
    "text": "Hello from cURL!"
  }'
```

## Future Enhancements

### Authentication
If user authentication is added:
- Include **JWT tokens** in request headers
- **Map JWT user ID to userId** for message ownership
- Consider **user registration endpoint** to associate userIds with accounts

### Message Features
Consider these additional features:
- **Message editing** (PATCH `/api/messages/:id`)
- **Message deletion** (DELETE `/api/messages/:id`)
- **Message reactions** (emoji responses)
- **File uploads** and media sharing
- **Message threading** or replies

### Real-time Implementation
For WebSocket implementation:
- **Connection endpoint**: `wss://api.example.com/ws`
- **Message format**: Same as REST API but wrapped in WebSocket envelope
- **Authentication**: Pass userId in connection query or headers

---

## Quick Start for Backend Dev

1. **Implement GET `/api/messages`** - Return array of existing messages
2. **Implement POST `/api/messages`** - Accept message, generate ULID, return saved message
3. **Test with frontend** - Should work immediately with these two endpoints
4. **Add validation** - Ensure userId/username/text requirements are met
5. **Consider real-time** - WebSocket or SSE for better UX

The frontend is designed to work with any backend that follows this API contract!
