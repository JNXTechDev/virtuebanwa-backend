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
const mongoURI = "mongodb+srv://vbdb:abcdefghij@cluster0.8i1sn.mongodb.net/Users?retryWrites=true&w=majority";

mongoose.connect(mongoURI, {
    serverApi: {
        version: '1',
        strict: true,
        deprecationErrors: true,
    }
})
    .then(() => console.log("MongoDB connected"))
    .catch(err => console.error("MongoDB connection error:", err));

// User schema
const userSchema = new mongoose.Schema({
    Username: { type: String, required: true, unique: true },
    Password: { type: String, default: 'defaultPassword' }, // Default password for students
    Role: { type: String, required: true, default: 'Student' }, // Default role is Student
    Section: {
        type: String,
        required: function () {
            return this.Role === 'Student';
        }
    },
    FirstName: { type: String, required: true },
    LastName: { type: String, required: true },
    FullName: { type: String, required: true }, // Add FullName field
    Character: { type: String, required: true },
    rewards_collected: [{
        reward: { type: String, required: true },
        message: { type: String, required: true },
        date: { type: Date, default: Date.now }
    }],
    AdminApproval: { 
        type: String, 
        enum: ['Pending', 'Approved', 'Rejected'],
        default: 'Pending'
    },
    CreatedBy: { 
        type: String,
        required: function() {
            return this.Role === 'Student';
        }
    }
});

const User = mongoose.model('User', userSchema);

// GET all users (FIXED: Added this missing route)
app.get('/api/users', async (req, res) => {
    try {
        const { teacherUsername } = req.query;
        let filter = {};
        
        // If teacherUsername is provided, filter students created by that teacher
        if (teacherUsername) {
            filter = {
                $and: [
                    { Role: 'Student' },
                    { CreatedBy: teacherUsername }
                ]
            };
        }

        const users = await User.find(filter, '-Password'); // Exclude passwords for security
        res.send(users);
    } catch (err) {
        res.status(500).send({ error: err.message });
    }
});

// GET user by username
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

// GET user by full name (Add this new endpoint)
app.get('/api/users/byname', async (req, res) => {
    const { fullname } = req.query;
    console.log(`Fetching user details for full name: ${fullname}`);

    if (!fullname) {
        return res.status(400).send({ error: 'Full name is required' });
    }

    try {
        const user = await User.findOne({ FullName: fullname });
        if (!user) {
            console.log(`User not found with full name: ${fullname}`);
            return res.status(404).send({ error: 'User not found.' });
        }

        console.log(`Found user: ${user.Username}`);
        res.send({
            Username: user.Username,
            Role: user.Role,
            Section: user.Section,
            FirstName: user.FirstName,
            LastName: user.LastName,
            Character: user.Character
        });
    } catch (err) {
        console.error(`Error fetching user by name: ${err.message}`);
        res.status(500).send({ error: err.message });
    }
});

// POST create a new user
app.post('/api/users', async (req, res) => {
    const { Username, Password, Role, Section, FirstName, LastName, Character, CreatedBy } = req.body;

    // Auto-generate FullName from FirstName and LastName
    const FullName = `${FirstName} ${LastName}`;

    console.log("Received data:", { Username, Password, Role, Section, FirstName, LastName, Character, FullName, CreatedBy });

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

        // Create new user with auto-generated FullName
        const newUser = new User({
            Username,
            Password,
            Role,
            Section,
            FirstName,
            LastName,
            Character,
            FullName, // Auto-generated FullName
            CreatedBy: Role === 'Student' ? CreatedBy : undefined
        });

        await newUser.save();

        console.log("User created:", newUser);
        res.status(201).send({ message: 'User created successfully', user: newUser });
    } catch (err) {
        res.status(500).send({ error: err.message });
    }
});

// Update the teacher registration route to handle Character field
app.post('/api/users/teacher', async (req, res) => {
    const { FirstName, LastName, EmployeeID, Username, Password, Role, AdminApproval, Character } = req.body;

    if (!FirstName || !LastName || !EmployeeID || !Username || !Password) {
        return res.status(400).send({ error: 'All fields are required.' });
    }

    try {
        const existingUser = await User.findOne({ Username });
        if (existingUser) {
            return res.status(400).send({ error: 'Username already exists.' });
        }

        const newTeacher = new User({
            FirstName,
            LastName,
            EmployeeID,
            Username,
            Password,
            Role: 'Teacher',
            AdminApproval: 'Pending',
            FullName: `${FirstName} ${LastName}`,
            Character: Character || 'Teacher' // Use provided Character or default to 'Teacher'
        });

        await newTeacher.save();
        res.status(201).send({ message: 'Teacher registration pending approval' });
    } catch (err) {
        res.status(500).send({ error: err.message });
    }
});

// POST login user
app.post('/api/login', async (req, res) => {
    const { Username, Password } = req.body;
    console.log(`Login attempt for username: ${Username}`);

    try {
        const user = await User.findOne({ Username });

        if (!user) {
            return res.status(401).send({ message: 'Invalid username or password' });
        }

        // Check AdminApproval for teachers
        if (user.Role === 'Teacher') {
            if (user.AdminApproval === 'Pending') {
                return res.status(401).send({
                    message: 'Your account is pending approval',
                    status: 'Pending'
                });
            }
            if (user.AdminApproval === 'Rejected') {
                return res.status(401).send({
                    message: 'Your account registration has been rejected',
                    status: 'Rejected'
                });
            }
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

// Classroom schema & routes
const classroomSchema = new mongoose.Schema({
    name: { type: String, required: true },
    code: { type: String, required: true, unique: true },
    teacherUsername: { type: String, required: true }
});

const Classroom = mongoose.model('Classroom', classroomSchema);

// POST create a new classroom
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

// GET classrooms by teacher username
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

// DELETE user by full name
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

// DELETE classroom by code
app.delete('/api/classrooms/:code', async (req, res) => {
    const { code } = req.params;

    try {
        await Classroom.deleteOne({ code });
        res.send({ message: 'Classroom deleted successfully' });
    } catch (err) {
        res.status(500).send({ error: err.message });
    }
});

// POST route for CSV upload
app.post('/api/upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send({ error: 'No file uploaded.' });
    }

    const teacherUsername = req.body.teacherUsername; // Get teacher username from request

    try {
        // Read the CSV file content
        const fileContent = fs.readFileSync(req.file.path, 'utf8');
        const lines = fileContent.split('\n');
        
        // Track successful and duplicate entries
        const stats = {
            added: 0,
            duplicates: 0,
            total: 0
        };

        // Process each line (skip header)
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line) {
                const [firstName, lastName, section, username, character] = line.split(',').map(s => s.trim());
                const fullName = `${firstName} ${lastName}`;

                if (firstName && lastName) {
                    try {
                        // Check if username already exists
                        const existingUser = await User.findOne({ Username: username });
                        
                        if (!existingUser) {
                            // Create new user only if username doesn't exist
                            const newUser = new User({
                                FirstName: firstName,
                                LastName: lastName,
                                FullName: fullName,
                                Role: 'Student',
                                Section: section || '',
                                Username: username,
                                Character: character || 'Character1',
                                Password: 'defaultPassword',
                                rewards_collected: [],
                                CreatedBy: teacherUsername
                            });
                            
                            await newUser.save();
                            stats.added++;
                        } else {
                            stats.duplicates++;
                        }
                        stats.total++;
                    } catch (err) {
                        console.error('Error processing student:', err);
                    }
                }
            }
        }

        // Clean up uploaded file
        fs.unlinkSync(req.file.path);

        // Send detailed response
        res.send({
            message: `File processed successfully. Added ${stats.added} new students, ${stats.duplicates} duplicates skipped.`,
            count: stats.added,
            stats: stats
        });

    } catch (err) {
        console.error('Error processing file:', err);
        res.status(500).send({ error: err.message });
    }
});

// POST route to add a reward to a user
app.post('/api/users/rewards', async (req, res) => {
    console.log("Received Reward Request:", req.body); // ✅ LOG INCOMING DATA

    const { fullName, reward, message } = req.body;

    if (!fullName || !reward || !message) {
        console.log("❌ Missing required fields:", { fullName, reward, message });
        return res.status(400).send({ error: 'Full name, reward, and message are required.' });
    }

    try {
        const user = await User.findOne({ FullName: fullName });
        if (!user) {
            console.log("❌ User not found:", fullName);
            return res.status(404).send({ error: 'User not found.' });
        }

        const newReward = { reward, message, date: new Date() };
        user.rewards_collected.push(newReward);
        await user.save();

        console.log("✅ Reward added successfully:", newReward);
        res.send({ message: 'Reward added successfully', user });
    } catch (err) {
        console.error("❌ Error adding reward:", err.message);
        res.status(500).send({ error: err.message });
    }
});


// GET unique sections
app.get('/api/sections', async (req, res) => {
    try {
        const users = await User.find({ Section: { $exists: true, $ne: '' } }, 'Section');
        const uniqueSections = [...new Set(users.map(user => user.Section))].sort();
        console.log("Found sections:", uniqueSections); // Debug log
        res.json(uniqueSections);
    } catch (err) {
        console.error("Error fetching sections:", err);
        res.status(500).send({ error: err.message });
    }
});



// Updated Game Progress Schema
const gameProgressSchema = new mongoose.Schema({
    username: { type: String, required: true },
    tutorial: {
        status: { type: String, default: 'Not Started' },
        reward: { type: String, default: '' },
        date: { type: Date }
    },
    lessons: {
        Unit1_Lesson1: {
            status: { type: String, default: 'Not Started' },
            reward: { type: String, default: '' },
            date: { type: Date }
        }
    }
}, { collection: "game_progress" });

const GameProgress = mongoose.model("GameProgress", gameProgressSchema);

// POST - Save game progress
app.post('/api/game_progress', async (req, res) => {
    try {
        const { username, tutorial, lessons } = req.body;

        if (!username) {
            return res.status(400).json({ error: "Username is required." });
        }

        let progress = await GameProgress.findOne({ username });

        if (!progress) {
            progress = new GameProgress({
                username,
                tutorial: tutorial || {},
                lessons: lessons || {}
            });
        } else {
            if (tutorial) {
                progress.tutorial = tutorial;
            }
            if (lessons) {
                progress.lessons = {
                    ...progress.lessons,
                    ...lessons
                };
            }
        }

        await progress.save();
        res.json({ message: "Game progress saved successfully", progress });
    } catch (err) {
        console.error('Error saving game progress:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET - Fetch user progress
app.get('/api/game_progress/:username', async (req, res) => {
    try {
        const { username } = req.params;
        const progress = await GameProgress.findOne({ username });

        if (!progress) {
            return res.json({
                username,
                tutorial: {
                    status: "Not Started",
                    reward: "",
                    date: null
                },
                lessons: {
                    Unit1_Lesson1: {
                        status: "Not Started",
                        reward: "",
                        date: null
                    }
                }
            });
        }

        res.json(progress);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server running on http://192.168.1.11:${PORT}`);
});
