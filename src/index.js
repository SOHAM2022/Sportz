import express from 'express';
import { eq } from 'drizzle-orm';
import { db, pool } from './db/db.js';
import { demoUsers } from './db/schema.js';

const app = express();
const PORT = 8000;

app.use(express.json());

app.get('/', (req, res) => {
  res.json({ message: 'Welcome to the Real-Time Sports Dashboard API' });
});

// CRUD Example Route
app.get('/crud-demo', async (req, res) => {
  try {
    console.log('Performing CRUD operations...');

    // CREATE: Insert a new user
    const [newUser] = await db
      .insert(demoUsers)
      .values({ name: 'Admin User', email: `admin-${Date.now()}@example.com` })
      .returning();

    if (!newUser) {
      throw new Error('Failed to create user');
    }
    console.log('✅ CREATE: New user created:', newUser);

    // READ: Select the user
    const foundUser = await db.select().from(demoUsers).where(eq(demoUsers.id, newUser.id));
    console.log('✅ READ: Found user:', foundUser[0]);

    // UPDATE: Change the user's name
    const [updatedUser] = await db
      .update(demoUsers)
      .set({ name: 'Super Admin' })
      .where(eq(demoUsers.id, newUser.id))
      .returning();
    console.log('✅ UPDATE: User updated:', updatedUser);

    // DELETE: Remove the user
    await db.delete(demoUsers).where(eq(demoUsers.id, newUser.id));
    console.log('✅ DELETE: User deleted.');

    res.json({
      success: true,
      operations: ['CREATE', 'READ', 'UPDATE', 'DELETE'],
      lastUser: updatedUser
    });
  } catch (error) {
    console.error('❌ Error performing CRUD operations:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
