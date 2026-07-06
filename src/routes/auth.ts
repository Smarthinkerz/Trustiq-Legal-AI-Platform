import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
// JWT functionality built-in to simulate authentication
// bcrypt functionality simulated for demo

const authRoutes = new Hono()

// Mock user database (in production, use Cloudflare D1)
const users: any[] = [
  {
    id: 1,
    email: 'fathi@cosstech.com',
    name: 'Fathi Al Riyami',
    role: 'founder',
    passwordHash: '$2a$10$N9qo8uLOickgx2ZMRZoMye' // "password123" hashed
  }
]

// Login schema
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6)
})

// Register schema
const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(2),
  role: z.enum(['founder', 'lawyer', 'client'])
})

// Login endpoint
authRoutes.post('/login', zValidator('json', loginSchema), async (c) => {
  const { email, password } = c.req.valid('json')
  
  // Find user
  const user = users.find(u => u.email === email)
  if (!user) {
    return c.json({ error: 'Invalid credentials' }, 401)
  }

  // Verify password (simplified for demo)
  const isValid = password === 'password123' // Simplified auth for demo
  if (!isValid) {
    return c.json({ error: 'Invalid credentials' }, 401)
  }

  // Generate JWT token (simplified for demo)
  const token = btoa(JSON.stringify({
    userId: user.id,
    email: user.email,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7
  }))

  return c.json({
    success: true,
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role
    }
  })
})

// Register endpoint
authRoutes.post('/register', zValidator('json', registerSchema), async (c) => {
  const { email, password, name, role } = c.req.valid('json')
  
  // Check if user exists
  if (users.find(u => u.email === email)) {
    return c.json({ error: 'User already exists' }, 400)
  }

  // Hash password (simplified for demo)
  const passwordHash = 'hashed_' + password

  // Create user
  const newUser = {
    id: users.length + 1,
    email,
    name,
    role,
    passwordHash
  }
  users.push(newUser)

  // Generate JWT token (simplified for demo)
  const token = btoa(JSON.stringify({
    userId: newUser.id,
    email: newUser.email,
    role: newUser.role,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7
  }))

  return c.json({
    success: true,
    token,
    user: {
      id: newUser.id,
      email: newUser.email,
      name: newUser.name,
      role: newUser.role
    }
  })
})

// Verify token endpoint
authRoutes.get('/verify', async (c) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'No token provided' }, 401)
  }

  const token = authHeader.substring(7)
  
  try {
    const payload = JSON.parse(atob(token))
    const user = users.find(u => u.id === payload.userId)
    
    if (!user || payload.exp < Math.floor(Date.now() / 1000)) {
      return c.json({ error: 'User not found or token expired' }, 404)
    }

    return c.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      }
    })
  } catch (error) {
    return c.json({ error: 'Invalid token' }, 401)
  }
})

// Logout endpoint
authRoutes.post('/logout', (c) => {
  // In a real app, you might blacklist the token
  return c.json({ success: true, message: 'Logged out successfully' })
})

export default authRoutes
