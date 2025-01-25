require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 5000;

// CORS configuration
const corsOptions = {
    origin: '*', // Allow all origins for testing purposes
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    preflightContinue: false,
    optionsSuccessStatus: 204
};

app.use(cors(corsOptions));
app.use(bodyParser.json());

// MongoDB connection string
const mongoURI = process.env.MONGO_URI;

mongoose.connect(mongoURI)
    .then(() => console.log("MongoDB connected"))
    .catch(err => console.error("MongoDB connection error:", err));

// User schema
const userSchema = new mongoose.Schema({
    Username: { type: String, required: true, unique: true },
    Password: { type: String, required: true },
    Role: { type: String, required: true },
    Section: {
        type: String,
        required: function () {
            return this.Role === 'Student';
        }
    },
    FirstName: { type: String, required: true }, // Add FirstName
    LastName: { type: String, required: true },  // Add LastName
    Character: { type: String, required: true }  // Add Character
});

const User = mongoose.model('User', userSchema);

// Create a new user
app.post('/api/users', async (req, res) => {
    const { Username, Password, Role, Section } = req.body;

    // Debug log to check the received data
    console.log("Received data:", { Username, Password, Role, Section });

    // Validate input
    if (!Username || !Password || !Role) {
        return res.status(400).send({ error: 'Username, Password, and Role are required.' });
    }

    // Additional validation for Students
    if (Role === 'Student' && !Section) {
        return res.status(400).send({ error: 'Section is required for Students.' });
    }

    try {
        // Check if the user already exists
        const existingUser = await User.findOne({ Username });
        if (existingUser) {
            return res.status(400).send({ error: 'Username already exists.' });
        }

        // Create a new user
        const newUser = new User({ Username, Password, Role, Section });
        await newUser.save();

        // Debug log to check the saved user
        console.log("User created:", newUser);

        res.status(201).send({ message: 'User created successfully', user: newUser });
    } catch (err) {
        res.status(500).send({ error: err.message });
    }
});

// Fetch user details by username
app.get('/api/users/:username', async (req, res) => {
    const { username } = req.params;
    console.log(`Fetching user details for username: ${username}`); // Debug log

    try {
        const user = await User.findOne({ Username: username });
        if (!user) {
            console.log(`User not found: ${username}`); // Debug log
            return res.status(404).send({ error: 'User not found.' });
        }

        console.log(`User found: ${user.Username}, Role: ${user.Role}`); // Debug log
        res.send({
            message: 'User found',
            user: {
                Username: user.Username,
                Role: user.Role,
                Section: user.Section,
                FirstName: user.FirstName, // Include FirstName
                LastName: user.LastName,   // Include LastName
                Character: user.Character  // Include Character
            }
        });
    } catch (err) {
        console.error(`Error fetching user details: ${err.message}`); // Debug log
        res.status(500).send({ error: err.message });
    }
});

// Login user
app.post('/api/login', async (req, res) => {
    const { Username, Password } = req.body;

    try {
        const user = await User.findOne({ Username, Password });
        if (!user) {
            return res.status(401).send({ message: 'Invalid username or password' });
        }
        res.send({
            message: 'Login successful',
            user: {
                Username: user.Username,
                Role: user.Role,
                Section: user.Section
            }
        });
    } catch (err) {
        res.status(500).send({ error: err.message });
    }
});


// Classroom schema
const classroomSchema = new mongoose.Schema({
    name: { type: String, required: true },
    code: { type: String, required: true, unique: true },
    teacherUsername: { type: String, required: true }
});

const Classroom = mongoose.model('Classroom', classroomSchema);

// Create a new classroom
app.post('/api/classrooms', async (req, res) => {
    const { name, code, teacherUsername } = req.body;

    if (!name || !code || !teacherUsername) {
        return res.status(400).send({ error: 'Name, code, and teacherUsername are required.' });
    }

    try {
        const newClassroom = new Classroom({ name, code, teacherUsername });
        await newClassroom.save();
        res.status(201).send({ message: 'Classroom created successfully', classroom: newClassroom });
    } catch (err) {
        res.status(500).send({ error: err.message });
    }
});

// Fetch classrooms by teacher username
app.get('/api/classrooms', async (req, res) => {
    const { teacherUsername } = req.query;

    if (!teacherUsername) {
        return res.status(400).send({ error: 'teacherUsername is required.' });
    }

    try {
        const classrooms = await Classroom.find({ teacherUsername });
        res.send({ classrooms });
    } catch (err) {
        res.status(500).send({ error: err.message });
    }
});

// Delete a classroom by code
app.delete('/api/classrooms/:code', async (req, res) => {
    const { code } = req.params;

    try {
        await Classroom.deleteOne({ code });
        res.send({ message: 'Classroom deleted successfully' });
    } catch (err) {
        res.status(500).send({ error: err.message });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server running on http://192.168.1.11:${PORT}`);
});