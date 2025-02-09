require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer');
const fs = require('fs');

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

// Multer configuration for file uploads
const upload = multer({ dest: 'uploads/' });

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
    FirstName: { type: String, required: true },
    LastName: { type: String, required: true },
    FullName: { type: String, required: true }, // Add FullName field
    Character: { type: String, required: true }
});

const User = mongoose.model('User', userSchema);

// ✅ GET all users (FIXED: Added this missing route)
app.get('/api/users', async (req, res) => {
    try {
        const users = await User.find({}, '-Password'); // Exclude passwords for security
        res.send(users);
    } catch (err) {
        res.status(500).send({ error: err.message });
    }
});

// ✅ GET user by username
app.get('/api/users/:username', async (req, res) => {
    const { username } = req.params;
    console.log(`Fetching user details for username: ${username}`);

    try {
        const user = await User.findOne({ Username: username });
        if (!user) {
            console.log(`User not found: ${username}`);
            return res.status(404).send({ error: 'User not found.' });
        }

        console.log(`User found: ${user.Username}, Role: ${user.Role}`);
        res.send({
            message: 'User found',
            user: {
                Username: user.Username,
                Role: user.Role,
                Section: user.Section,
                FirstName: user.FirstName,
                LastName: user.LastName,
                Character: user.Character
            }
        });
    } catch (err) {
        console.error(`Error fetching user details: ${err.message}`);
        res.status(500).send({ error: err.message });
    }
});

// ✅ POST create a new user
app.post('/api/users', async (req, res) => {
    const { Username, Password, Role, Section, FirstName, LastName, Character } = req.body;
    console.log("Received data:", { Username, Password, Role, Section });

    if (!Username || !Password || !Role || !FirstName || !LastName || !Character) {
        return res.status(400).send({ error: 'Missing required fields.' });
    }

    if (Role === 'Student' && !Section) {
        return res.status(400).send({ error: 'Section is required for Students.' });
    }

    try {
        const existingUser = await User.findOne({ Username });
        if (existingUser) {
            return res.status(400).send({ error: 'Username already exists.' });
        }

        const newUser = new User({ Username, Password, Role, Section, FirstName, LastName, Character });
        await newUser.save();

        console.log("User created:", newUser);
        res.status(201).send({ message: 'User created successfully', user: newUser });
    } catch (err) {
        res.status(500).send({ error: err.message });
    }
});

// ✅ POST login user
app.post('/api/login', async (req, res) => {
    const { Username, Password } = req.body;
    console.log(`Login attempt for username: ${Username}`);

    try {
        const user = await User.findOne({ Username });

        if (!user) {
            console.log(`Login failed for username: ${Username}`);
            return res.status(401).send({ message: 'Invalid username or password' });
        }

        if (user.Role === 'Student') {
            console.log(`Login successful for student: ${Username}`);
            return res.send({
                message: 'Login successful',
                user: {
                    Username: user.Username,
                    Role: user.Role,
                    Section: user.Section,
                    FirstName: user.FirstName,
                    LastName: user.LastName,
                    Character: user.Character
                }
            });
        } else {
            if (user.Password !== Password) {
                console.log(`Login failed for username: ${Username}`);
                return res.status(401).send({ message: 'Invalid username or password' });
            }

            console.log(`Login successful for username: ${Username}`);
            res.send({
                message: 'Login successful',
                user: {
                    Username: user.Username,
                    Role: user.Role,
                    Section: user.Section,
                    FirstName: user.FirstName,
                    LastName: user.LastName,
                    Character: user.Character
                }
            });
        }
    } catch (err) {
        console.error(`Error during login: ${err.message}`);
        res.status(500).send({ error: err.message });
    }
});

// ✅ Classroom schema & routes
const classroomSchema = new mongoose.Schema({
    name: { type: String, required: true },
    code: { type: String, required: true, unique: true },
    teacherUsername: { type: String, required: true }
});

const Classroom = mongoose.model('Classroom', classroomSchema);

// ✅ POST create a new classroom
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

// ✅ GET classrooms by teacher username
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

// ✅ DELETE user by full name
app.delete('/api/users/remove', async (req, res) => {
    const { fullname } = req.query; // Get full name from query parameters

    if (!fullname) {
        return res.status(400).send({ error: 'Full name is required.' });
    }

    try {
        const result = await User.findOneAndDelete({ FullName: fullname });

        if (!result) {
            return res.status(404).send({ error: 'User not found.' });
        }

        res.send({ message: 'Successfully removed student.' });
    } catch (err) {
        console.error(`Error removing user: ${err.message}`);
        res.status(500).send({ error: err.message });
    }
});

// ✅ DELETE classroom by code
app.delete('/api/classrooms/:code', async (req, res) => {
    const { code } = req.params;

    try {
        await Classroom.deleteOne({ code });
        res.send({ message: 'Classroom deleted successfully' });
    } catch (err) {
        res.status(500).send({ error: err.message });
    }
});

// Update the POST route for CSV upload to handle form-data properly
app.post('/api/upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send({ error: 'No file uploaded.' });
    }

    try {
        // Read the CSV file content
        const fileContent = fs.readFileSync(req.file.path, 'utf8');
        const lines = fileContent.split('\n');
        
        // Skip header row and process each line
        const students = [];
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line) {
                const [firstName, lastName, role, section, username, character] = line.split(',').map(s => s.trim());
                if (firstName && lastName) {
                    students.push({
                        FirstName: firstName,
                        LastName: lastName,
                        FullName: `${firstName} ${lastName}`,
                        Role: role || 'Student',
                        Section: section || '',
                        Username: username || `${firstName.toLowerCase()}${lastName.toLowerCase()}`,
                        Character: character || 'Character1'
                    });
                }
            }
        }

        // Insert all students
        if (students.length > 0) {
            await User.insertMany(students);
            fs.unlinkSync(req.file.path); // Clean up uploaded file
            res.send({ message: 'File processed successfully', count: students.length });
        } else {
            res.status(400).send({ error: 'No valid student data found in file' });
        }
    } catch (err) {
        console.error('Error processing file:', err);
        res.status(500).send({ error: err.message });
    }
});

// ✅ Start the server
app.listen(PORT, () => {
    console.log(`Server running on http://192.168.1.11:${PORT}`);
});
