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
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept', 'Authorization'],
    credentials: true,
    optionsSuccessStatus: 200
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
    EmployeeID: { type: String }, // Add explicit definition if missing
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

// Important: Place specific routes BEFORE parameterized routes
// GET user by full name
app.get('/api/users/byname', async (req, res) => {
    const { fullname } = req.query;
    const trimmedName = fullname ? fullname.trim() : '';
    
    console.log(`[Server] Raw fullname: "${fullname}"`);
    console.log(`[Server] Trimmed fullname: "${trimmedName}"`);

    if (!trimmedName) {
        return res.status(400).send({ error: 'Full name is required' });
    }

    try {
        // Log all users first for debugging
        const allUsers = await User.find({}, 'FullName Role Username');
        console.log('[Server] All users in database:');
        allUsers.forEach(u => {
            console.log(`  "${u.FullName}" (${u.Role})`);
        });

        // Try exact match first
        let user = await User.findOne({ FullName: trimmedName });
        console.log('[Server] Exact match result:', user ? 'Found' : 'Not found');

        if (!user) {
            // Try case-insensitive match
            const query = { 
                FullName: { 
                    $regex: new RegExp(`^${trimmedName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}$`, 'i') 
                }
            };
            console.log('[Server] Trying case-insensitive search:', JSON.stringify(query));
            
            user = await User.findOne(query);
            console.log('[Server] Case-insensitive match result:', user ? 'Found' : 'Not found');
        }

        if (!user) {
            console.log(`[Server] No user found with name: "${trimmedName}"`);
            return res.status(404).send({ error: 'User not found.' });
        }

        res.send({
            Username: user.Username,
            Role: user.Role,
            Section: user.Section,
            FirstName: user.FirstName,
            LastName: user.LastName,
            Character: user.Character
        });
    } catch (err) {
        console.error('[Server] Error:', err);
        res.status(500).send({ error: err.message });
    }
});

// AFTER the byname route, place the parameterized route
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


// Modify the GameProgress schema to limit to only 2 units

//here
const gameProgressSchema = new mongoose.Schema({
    Username: { type: String, required: true },
    tutorial: {
        status: { type: String, default: 'Available' },
        date: { type: Date },
        // Add checkpoints to track individual NPC completion
        checkpoints: {
            type: Map,
            of: {
                reward: { type: String, default: '' },
                status: { type: String, default: 'Not Completed' },
                date: { type: Date },
                message: { type: String },
                score: { type: Number, default: 0 }
            },
            default: new Map()
        }
    },
    units: {
        Unit1: {
            status: { type: String, default: 'Not Started' },
            completedLessons: { type: Number, default: 0 },
            unitScore: { type: Number, default: 0 },
            unitTotalQuestions: { type: Number, default: 0 },
            unitScoreDisplay: { type: String, default: '' },
            lessons: {
                PreTest: {
                    status: { type: String, default: 'Locked' },
                    reward: { type: String, default: '' },
                    score: { type: Number, default: 0 },
                    totalQuestions: { type: Number, default: 0 },
                    scoreDisplay: { type: String, default: '' },
                    lastAttempt: { type: Date },
                    // Add checkpoints to match tutorial format
                    checkpoints: {
                        type: Map,
                        of: {
                            reward: { type: String, default: '' },
                            status: { type: String, default: 'Not Completed' },
                            date: { type: Date },
                            message: { type: String },
                            score: { type: Number, default: 0 }
                        },
                        default: new Map()
                    }
                },
                Lesson1: {
                    status: { type: String, default: 'Locked' },
                    lastAttempt: { type: Date },
                    // Add checkpoints to match tutorial format
                    checkpoints: {
                        type: Map,
                        of: {
                            reward: { type: String, default: '' },
                            status: { type: String, default: 'Not Completed' },
                            date: { type: Date },
                            message: { type: String },
                            score: { type: Number, default: 0 }
                        },
                        default: new Map()
                    }
                },



                Lesson2: {
                    status: { type: String, default: 'Locked' },
                    lastAttempt: { type: Date },
                    // Add checkpoints to match tutorial format
                    checkpoints: {
                        type: Map,
                        of: {
                            reward: { type: String, default: '' },
                            status: { type: String, default: 'Not Completed' },
                            date: { type: Date },
                            message: { type: String },
                            score: { type: Number, default: 0 }
                        },
                        default: new Map()
                    }
                },

                Lesson3: {
                    status: { type: String, default: 'Locked' },
                    lastAttempt: { type: Date },
                    // Add checkpoints to match tutorial format
                    checkpoints: {
                        type: Map,
                        of: {
                            reward: { type: String, default: '' },
                            status: { type: String, default: 'Not Completed' },
                            date: { type: Date },
                            message: { type: String },
                            score: { type: Number, default: 0 }
                        },
                        default: new Map()
                    }
                },



                Lesson4: {
                    status: { type: String, default: 'Locked' },
                    lastAttempt: { type: Date },
                    // Add checkpoints to match tutorial format
                    checkpoints: {
                        type: Map,
                        of: {
                            reward: { type: String, default: '' },
                            status: { type: String, default: 'Not Completed' },
                            date: { type: Date },
                            message: { type: String },
                            score: { type: Number, default: 0 }
                        },
                        default: new Map()
                    }
                },
                Lesson5: {
                        status: { type: String, default: 'Locked' },
                        lastAttempt: { type: Date },
                        // Add checkpoints to match tutorial format
                        checkpoints: {
                            type: Map,
                            of: {
                                reward: { type: String, default: '' },
                                status: { type: String, default: 'Not Completed' },
                                date: { type: Date },
                                message: { type: String },
                                score: { type: Number, default: 0 }
                            },
                            default: new Map()
                        }
                    },
                Lesson6: {
                    status: { type: String, default: 'Locked' },
                    lastAttempt: { type: Date },
                    // Add checkpoints to match tutorial format
                    checkpoints: {
                        type: Map,
                        of: {
                            reward: { type: String, default: '' },
                            status: { type: String, default: 'Not Completed' },
                            date: { type: Date },
                            message: { type: String },
                            score: { type: Number, default: 0 }
                        },
                        default: new Map()
                    }
                },
            },
            postTest: {
                status: { type: String, default: 'Locked' },
                reward: { type: String, default: '' },
                score: { type: Number, default: 0 },
                totalQuestions: { type: Number, default: 0 },
                scoreDisplay: { type: String, default: '' },
                passed: { type: Boolean, default: false },
                date: { type: Date },
                checkpoints: {
                    type: Map,
                    of: {
                        reward: { type: String, default: '' },
                        status: { type: String, default: 'Not Completed' },
                        date: { type: Date },
                        message: { type: String },
                        score: { type: Number, default: 0 },
                        totalQuestions: { type: Number, default: 0 },
                        scoreDisplay: { type: String, default: '' }
                    },
                    default: new Map()
                }
            }
        },


        Unit2: {
            status: { type: String, default: 'Not Started' },
            completedLessons: { type: Number, default: 0 },
            unitScore: { type: Number, default: 0 },
            lessons: {
                PreTest: {
                    status: { type: String, default: 'Locked' },
                    reward: { type: String, default: '' },
                    score: { type: Number, default: 0 },
                    totalQuestions: { type: Number, default: 0 },
                    scoreDisplay: { type: String, default: '' },
                    lastAttempt: { type: Date },
                    // Add checkpoints to match tutorial format
                    checkpoints: {
                        type: Map,
                        of: {
                            reward: { type: String, default: '' },
                            status: { type: String, default: 'Not Completed' },
                            date: { type: Date },
                            message: { type: String },
                            score: { type: Number, default: 0 }
                        },
                        default: new Map()
                    }
                },
                Lesson1: {
                    status: { type: String, default: 'Locked' },
                    lastAttempt: { type: Date },
                    // Add checkpoints to match tutorial format
                    checkpoints: {
                        type: Map,
                        of: {
                            reward: { type: String, default: '' },
                            status: { type: String, default: 'Not Completed' },
                            date: { type: Date },
                            message: { type: String },
                            score: { type: Number, default: 0 }
                        },
                        default: new Map()
                    }
                },



                Lesson2: {
                    status: { type: String, default: 'Locked' },
                    lastAttempt: { type: Date },
                    // Add checkpoints to match tutorial format
                    checkpoints: {
                        type: Map,
                        of: {
                            reward: { type: String, default: '' },
                            status: { type: String, default: 'Not Completed' },
                            date: { type: Date },
                            message: { type: String },
                            score: { type: Number, default: 0 }
                        },
                        default: new Map()
                    }
                },

                Lesson3: {
                    status: { type: String, default: 'Locked' },
                    lastAttempt: { type: Date },
                    // Add checkpoints to match tutorial format
                    checkpoints: {
                        type: Map,
                        of: {
                            reward: { type: String, default: '' },
                            status: { type: String, default: 'Not Completed' },
                            date: { type: Date },
                            message: { type: String },
                            score: { type: Number, default: 0 }
                        },
                        default: new Map()
                    }
                },



                Lesson4: {
                    status: { type: String, default: 'Locked' },
                    lastAttempt: { type: Date },
                    // Add checkpoints to match tutorial format
                    checkpoints: {
                        type: Map,
                        of: {
                            reward: { type: String, default: '' },
                            status: { type: String, default: 'Not Completed' },
                            date: { type: Date },
                            message: { type: String },
                            score: { type: Number, default: 0 }
                        },
                        default: new Map()
                    }
                },
                Lesson5: {
                        status: { type: String, default: 'Locked' },
                        lastAttempt: { type: Date },
                        // Add checkpoints to match tutorial format
                        checkpoints: {
                            type: Map,
                            of: {
                                reward: { type: String, default: '' },
                                status: { type: String, default: 'Not Completed' },
                                date: { type: Date },
                                message: { type: String },
                                score: { type: Number, default: 0 }
                            },
                            default: new Map()
                        }
                    },
                Lesson6: {
                    status: { type: String, default: 'Locked' },
                    lastAttempt: { type: Date },
                    // Add checkpoints to match tutorial format
                    checkpoints: {
                        type: Map,
                        of: {
                            reward: { type: String, default: '' },
                            status: { type: String, default: 'Not Completed' },
                            date: { type: Date },
                            message: { type: String },
                            score: { type: Number, default: 0 }
                        },
                        default: new Map()
                    }
                },
            },
            postTest: {
                status: { type: String, default: 'Locked' },
                reward: { type: String, default: '' },
                score: { type: Number, default: 0 },
                totalQuestions: { type: Number, default: 0 },
                scoreDisplay: { type: String, default: '' },
                passed: { type: Boolean, default: false },
                date: { type: Date },
                checkpoints: {
                    type: Map,
                    of: {
                        reward: { type: String, default: '' },
                        status: { type: String, default: 'Not Completed' },
                        date: { type: Date },
                        message: { type: String },
                        score: { type: Number, default: 0 },
                        totalQuestions: { type: Number, default: 0 },
                        scoreDisplay: { type: String, default: '' }
                    },
                    default: new Map()
                }
            }
        }
        // Remove Unit3 and Unit4 since we only need 2 units
    },
    currentUnit: { 
        type: String, 
        default: function() {
            // Dynamically determine the current unit based on progress
            if (this.units && this.units.Unit2 && this.units.Unit2.status !== 'Locked') {
                return 'Unit2';
            }
            return 'Unit1';
        }
    },
    currentLesson: { 
        type: String, 
        get: function() {
            // Dynamically determine the current lesson based on progress
            const unitKey = this.currentUnit || 'Unit1';
            const unit = this.units && this.units[unitKey];
            
            if (!unit || !unit.lessons) return 'Lesson1';
            
            // Check in standard lesson sequence
            const lessonOrder = ['PreTest', 'Lesson1', 'Lesson2', 'Lesson3', 'Lesson4', 'Lesson5', 'Lesson6'];
            
            // Find the first available lesson that isn't completed
            for (const lessonId of lessonOrder) {
                const lesson = unit.lessons[lessonId];
                if (lesson && lesson.status === 'Available') {
                    return lessonId;
                }
            }
            
            // If all lessons are completed, check post test
            if (unit.postTest && unit.postTest.status === 'Available') {
                return 'PostTest';
            }
            
            // If everything is completed or locked, default to Lesson1
            return 'Lesson1';
        }
    }
}, { collection: "game_progress" });


//start
// gameprogress update for post test:
// POST route for post test:
app.post('/api/save_post_test', async (req, res) => {
    try {
        const { Username, unitId, score, totalQuestions, passed, reward, message } = req.body;
        
        // Validate required fields
        if (!Username || !unitId || score === undefined || totalQuestions === undefined || passed === undefined) {
            return res.status(400).json({ 
                error: 'Missing required fields',
                required: ['Username', 'unitId', 'score', 'totalQuestions', 'passed']
            });
        }

        console.log(`[save_post_test] Saving post test for ${Username}/${unitId}: ${score}/${totalQuestions}, passed: ${passed}`);

        // Calculate score display
        const scoreDisplay = `${score}/${totalQuestions}`;
        
        // Find or create progress document
        let progress = await GameProgress.findOne({ Username }) || new GameProgress({ Username });
        
        // Initialize unit if it doesn't exist
        if (!progress.units[unitId]) {
            progress.units[unitId] = {
                status: 'Not Started',
                completedLessons: 0,
                lessons: {}
            };
        }
        
        // Initialize postTest if it doesn't exist
        if (!progress.units[unitId].postTest) {
            progress.units[unitId].postTest = {
                status: 'Locked',
                reward: '',
                score: 0,
                totalQuestions: 0,
                scoreDisplay: '',
                passed: false,
                checkpoints: new Map()
            };
        }
        
        // Update post test data
        progress.units[unitId].postTest.status = 'Completed';
        progress.units[unitId].postTest.score = score;
        progress.units[unitId].postTest.totalQuestions = totalQuestions;
        progress.units[unitId].postTest.scoreDisplay = scoreDisplay;
        progress.units[unitId].postTest.passed = passed;
        progress.units[unitId].postTest.reward = reward || (passed ? 'FiveStar' : 'TwoStar');
        progress.units[unitId].postTest.date = new Date();
        
        // Update Principal checkpoint
        const principalCheckpoint = {
            status: 'Completed',
            reward: reward || (passed ? 'FiveStar' : 'TwoStar'),
            date: new Date(),
            message: message || (passed ? 'You passed the Post-Test successfully!' : 'You completed the Post-Test. Keep studying!'),
            score: score,
            totalQuestions: totalQuestions,
            scoreDisplay: scoreDisplay
        };
        
        progress.units[unitId].postTest.checkpoints.set('PrincipalPostTest', principalCheckpoint);
        
        // Mark unit as completed
        progress.units[unitId].status = 'Completed';
        
        // If this is Unit1 and passed, unlock Unit2
        if (passed && unitId === 'Unit1') {
            if (!progress.units.Unit2) {
                progress.units.Unit2 = {
                    status: 'Available',
                    completedLessons: 0,
                    lessons: {
                        PreTest: {
                            status: 'Available'
                        }
                    }
                };
            } else {
                progress.units.Unit2.status = 'Available';
                if (!progress.units.Unit2.lessons.PreTest) {
                    progress.units.Unit2.lessons.PreTest = { status: 'Available' };
                } else {
                    progress.units.Unit2.lessons.PreTest.status = 'Available';
                }
            }
        }
        
        // Mark modified paths
        progress.markModified(`units.${unitId}.postTest`);
        progress.markModified(`units.${unitId}.postTest.checkpoints`);
        progress.markModified(`units.${unitId}.status`);
        
        if (passed && unitId === 'Unit1') {
            progress.markModified('units.Unit2');
            progress.markModified('units.Unit2.lessons.PreTest');
        }
        
        // Save changes
        await progress.save();
        
        res.json({ 
            success: true,
            message: 'Post test results saved successfully',
            postTest: {
                unitId,
                score,
                totalQuestions,
                scoreDisplay,
                passed,
                reward: reward || (passed ? 'FiveStar' : 'TwoStar'),
                status: 'Completed'
            }
        });
    } catch (error) {
        console.error('Error saving post test:', error);
        res.status(500).json({ 
            error: 'Server error',
            message: error.message 
        });
    }
});

//end


const GameProgress = mongoose.model("GameProgress", gameProgressSchema);

// POST - Save game progress
//start here
app.post('/api/game_progress', async (req, res) => {
    try {
        const { Username, tutorial, units, currentUnit, currentLesson } = req.body;
        
        if (!Username) {
            return res.status(400).json({ error: 'Username is required' });
        }

        let progress = await GameProgress.findOne({ Username });
        
        if (!progress) {
            progress = new GameProgress({ Username });
        }

        // Handle tutorial updates
        if (tutorial) {
            const updateTime = new Date();

            if (tutorial.checkpoints) {
                Object.keys(tutorial.checkpoints).forEach(npcName => {
                    const checkpointData = tutorial.checkpoints[npcName];
                    if (checkpointData && checkpointData.status) {
                        progress.tutorial.checkpoints.set(npcName, {
                            reward: checkpointData.reward || "OneStar",
                            status: checkpointData.status,
                            date: checkpointData.date ? new Date(checkpointData.date) : updateTime
                        });
                    }
                });
            }

            const requiredNPCs = ["Janica", "Mark", "Annie", "Rojan"];
            const completedNPCs = Array.from(progress.tutorial.checkpoints.entries())
                .filter(([npcName, checkpoint]) => requiredNPCs.includes(npcName) && checkpoint.status === "Completed")
                .map(([npcName]) => npcName);

            if (completedNPCs.length === requiredNPCs.length) {
                progress.tutorial.status = "Completed";

                if (progress.units && progress.units.Unit1 && progress.units.Unit1.lessons) {
                    if (progress.units.Unit1.lessons.PreTest.status === "Locked") {
                        progress.units.Unit1.lessons.PreTest.status = "Available";
                    }
                }
            } else if (completedNPCs.length > 0) {
                progress.tutorial.status = "In Progress";
            } else {
                progress.tutorial.status = "Not Started";
            }
        }

        // Handle units updates
        if (units) {
            Object.keys(units).forEach(unitKey => {
                const updatedUnit = units[unitKey];
                
                if (!progress.units[unitKey]) {
                    progress.units[unitKey] = {
                        status: updatedUnit.status || "Not Started",
                        completedLessons: updatedUnit.completedLessons || 0,
                        unitScore: updatedUnit.unitScore || 0,
                        lessons: {}
                    };
                }

                // Check for direct PreTest data updates
                if (updatedUnit.preTest) {
                    // This is a test result update
                    const preTestData = updatedUnit.preTest;
                    const score = preTestData.score || 0;
                    const passed = preTestData.passed || false;
                    const reward = passed ? "FiveStar" : "TwoStar";
                    
                    console.log(`Processing PreTest update: score=${score}, passed=${passed}, reward=${reward}`);
                    
                    // Make sure preTest object exists in unit
                    if (!progress.units[unitKey].preTest) {
                        progress.units[unitKey].preTest = {
                            status: preTestData.status || 'Not Started',
                            score: score,
                            passed: passed,
                            date: preTestData.date ? new Date(preTestData.date) : new Date()
                        };
                    } else {
                        progress.units[unitKey].preTest.status = preTestData.status || progress.units[unitKey].preTest.status;
                        progress.units[unitKey].preTest.score = score;
                        progress.units[unitKey].preTest.passed = passed;
                        progress.units[unitKey].preTest.date = preTestData.date ? new Date(preTestData.date) : new Date();
                    }
                    
                    // Also update the PreTest lesson to match the test result
                    if (!progress.units[unitKey].lessons.PreTest) {
                        progress.units[unitKey].lessons.PreTest = {
                            status: preTestData.status || 'Not Started',
                            score: score,
                            reward: reward,
                            lastAttempt: new Date()
                        };
                    } else {
                        progress.units[unitKey].lessons.PreTest.status = preTestData.status || progress.units[unitKey].lessons.PreTest.status;
                        progress.units[unitKey].lessons.PreTest.score = score;
                        progress.units[unitKey].lessons.PreTest.reward = reward;
                        progress.units[unitKey].lessons.PreTest.lastAttempt = new Date();
                    }
                    
                    // If there is a Principal checkpoint, update it to match test score
                    if (progress.units[unitKey].lessons.PreTest.checkpoints instanceof Map && 
                        progress.units[unitKey].lessons.PreTest.checkpoints.has('Principal')) {
                        
                        const principal = progress.units[unitKey].lessons.PreTest.checkpoints.get('Principal');
                        principal.score = score;
                        principal.reward = reward;
                        principal.message = passed ? 
                            "You passed the Pre-Test successfully!" : 
                            "You completed the Pre-Test. Keep studying!";
                        
                        progress.units[unitKey].lessons.PreTest.checkpoints.set('Principal', principal);
                        progress.markModified(`units.${unitKey}.lessons.PreTest.checkpoints`);
                    }
                }

                if (updatedUnit.lessons) {
                    Object.keys(updatedUnit.lessons).forEach(lessonKey => {
                        const updatedLesson = updatedUnit.lessons[lessonKey];
                        
                        if (!progress.units[unitKey].lessons[lessonKey]) {
                            progress.units[unitKey].lessons[lessonKey] = {
                                status: updatedLesson.status || "Locked",
                                reward: updatedLesson.reward || "",
                                score: updatedLesson.score || 0,
                                // Initialize checkpoints if this is PreTest
                                checkpoints: lessonKey === "PreTest" ? new Map() : undefined
                            };
                        }

                        // Handle checkpoints for PreTest lessons (similar to tutorial checkpoints)
                        if (lessonKey === "PreTest" && updatedLesson.checkpoints) {
                            if (!progress.units[unitKey].lessons[lessonKey].checkpoints) {
                                progress.units[unitKey].lessons[lessonKey].checkpoints = {};
                            }
                            
                            Object.keys(updatedLesson.checkpoints).forEach(npcName => {
                                const checkpoint = updatedLesson.checkpoints[npcName];
                                progress.units[unitKey].lessons[lessonKey].checkpoints[npcName] = {
                                    status: checkpoint.status,
                                    reward: checkpoint.reward,
                                    date: checkpoint.date ? new Date(checkpoint.date) : new Date(),
                                    message: checkpoint.message,
                                    score: checkpoint.score
                                };
                            });
                            
                            progress.markModified(`units.${unitKey}.lessons.${lessonKey}.checkpoints`);
                        }

                        // ...existing npcsTalkedTo and rewards handling...
                        if (updatedLesson.npcsTalkedTo && Array.isArray(updatedLesson.npcsTalkedTo)) {
                            updatedLesson.npcsTalkedTo.forEach(npc => {
                                if (!progress.units[unitKey].lessons[lessonKey].npcsTalkedTo.includes(npc)) {
                                    progress.units[unitKey].lessons[lessonKey].npcsTalkedTo.push(npc);
                                }
                            });
                        }

                        if (updatedLesson.rewards && typeof updatedLesson.rewards === 'object') {
                            Object.keys(updatedLesson.rewards).forEach(npcName => {
                                const rewardData = updatedLesson.rewards[npcName];
                                progress.units[unitKey].lessons[lessonKey].rewards.set(npcName, {
                                    type: rewardData.type,
                                    message: rewardData.message,
                                    score: rewardData.score,
                                    date: rewardData.date ? new Date(rewardData.date) : new Date()
                                });
                            });
                        }

                        if (updatedLesson.status) {
                            progress.units[unitKey].lessons[lessonKey].status = updatedLesson.status;

                            if (updatedLesson.status === "Completed") {
                                const lessonOrder = [
                                    "PreTest", "Lesson1", "Lesson2", "Lesson3", "Lesson4", "Lesson5", "Lesson6", "PostTest"
                                ];
                                const currentIndex = lessonOrder.indexOf(lessonKey);
                                if (currentIndex !== -1 && currentIndex + 1 < lessonOrder.length) {
                                    const nextLessonKey = lessonOrder[currentIndex + 1];
                                    if (progress.units[unitKey].lessons[nextLessonKey]?.status === "Locked") {
                                        progress.units[unitKey].lessons[nextLessonKey].status = "Available";
                                    }
                                }
                            }
                        }
                    });

                    // Ensure PreTest data is synced
                    if (updatedUnit.lessons.PreTest) {
                        const lessonPreTest = updatedUnit.lessons.PreTest;
                        const score = lessonPreTest.score || 0;
                        const reward = lessonPreTest.reward || (score >= 50 ? "FiveStar" : "TwoStar");
                        
                        // Make sure the top-level PreTest is updated
                        if (progress.units[unitKey].preTest) {
                            progress.units[unitKey].preTest.score = score;
                            progress.units[unitKey].preTest.status = lessonPreTest.status || progress.units[unitKey].preTest.status;
                            progress.units[unitKey].preTest.passed = score >= 50;
                            progress.units[unitKey].preTest.date = new Date();
                        }
                        
                        // Make sure the Principal checkpoint is updated
                        if (progress.units[unitKey].lessons.PreTest.checkpoints instanceof Map && 
                            progress.units[unitKey].lessons.PreTest.checkpoints.has('Principal')) {
                            
                            const principal = progress.units[unitKey].lessons.PreTest.checkpoints.get('Principal');
                            principal.score = score;
                            principal.reward = reward;
                            
                            progress.units[unitKey].lessons.PreTest.checkpoints.set('Principal', principal);
                            progress.markModified(`units.${unitKey}.lessons.PreTest.checkpoints`);
                        }
                    }
                }

                const totalLessons = Object.keys(progress.units[unitKey].lessons).length;
                const completedLessons = Object.values(progress.units[unitKey].lessons).filter(lesson => lesson.status === "Completed").length;

                progress.units[unitKey].completedLessons = completedLessons;
                if (completedLessons === totalLessons) {
                    progress.units[unitKey].status = "Completed";
                } else if (completedLessons > 0) {
                    progress.units[unitKey].status = "In Progress";
                } else {
                    progress.units[unitKey].status = "Not Started";
                }
            });
        }

        progress.markModified('units');
        progress.markModified('tutorial.checkpoints');

        await progress.save();

        const responseData = progress.toObject();
        
        if (progress.tutorial.checkpoints) {
            responseData.tutorial.checkpoints = {};
            progress.tutorial.checkpoints.forEach((value, key) => {
                responseData.tutorial.checkpoints[key] = value;
            });
        }

        Object.keys(responseData.units).forEach(unitKey => {
            Object.keys(responseData.units[unitKey].lessons).forEach(lessonKey => {
                if (responseData.units[unitKey].lessons[lessonKey].rewards) {
                    const rewardsObj = {};
                    progress.units[unitKey].lessons[lessonKey].rewards.forEach((value, key) => {
                        rewardsObj[key] = value;
                    });
                    responseData.units[unitKey].lessons[lessonKey].rewards = rewardsObj;
                }
            });
        });

        res.json({ 
            message: 'Progress saved successfully', 
            data: responseData
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

//end here

// GET - Fetch user progress
app.get('/api/game_progress/:username', async (req, res) => {
    try {
        const { username } = req.params;
        console.log(`[GET game_progress] Fetching progress for username: ${username}`);
        
        // Use case-insensitive search to be consistent with debug endpoint
        const progress = await GameProgress.findOne({ Username: { $regex: `^${username}$`, $options: 'i' } });

        if (!progress) {
            console.log(`[GET game_progress] No progress found for: ${username}`);
            return res.json({
                Username: username,
                tutorial: { status: "Not Started", reward: "", date: null },
                lessons: {}
            });
        }

        // Convert Maps to plain objects for JSON response
        const responseData = progress.toObject();
        
        // Process tutorial checkpoints
        if (progress.tutorial && progress.tutorial.checkpoints instanceof Map) {
            responseData.tutorial.checkpoints = {};
            progress.tutorial.checkpoints.forEach((value, key) => {
                responseData.tutorial.checkpoints[key] = value;
            });
        }
        
        // Process all lesson checkpoints in all units
        if (responseData.units) {
            Object.keys(responseData.units).forEach(unitKey => {
                const unit = responseData.units[unitKey];
                
                if (unit.lessons) {
                    Object.keys(unit.lessons).forEach(lessonKey => {
                        const lesson = unit.lessons[lessonKey];
                        
                        // Convert lesson checkpoints from Map to object
                        if (progress.units[unitKey].lessons[lessonKey].checkpoints instanceof Map) {
                            responseData.units[unitKey].lessons[lessonKey].checkpoints = {};
                            
                            progress.units[unitKey].lessons[lessonKey].checkpoints.forEach((value, key) => {
                                responseData.units[unitKey].lessons[lessonKey].checkpoints[key] = value;
                            });
                        }
                    });
                }
                
                // Process postTest checkpoints if they exist
                if (unit.postTest && progress.units[unitKey].postTest.checkpoints instanceof Map) {
                    responseData.units[unitKey].postTest.checkpoints = {};
                    progress.units[unitKey].postTest.checkpoints.forEach((value, key) => {
                        responseData.units[unitKey].postTest.checkpoints[key] = value;
                    });
                }
            });
        }

        console.log(`[GET game_progress] Successfully processed progress data for: ${username}`);
        res.json(responseData);
    } catch (error) {
        console.error('Error fetching game progress:', error);
        res.status(500).json({ 
            message: 'Server error',
            error: error.message 
        });
    }
});

// UPDATE DELETE ENDPOINT: Reset tutorial progress
app.delete('/api/game_progress/:username/tutorial', async (req, res) => {
    try {
        const { username } = req.params;
        console.log(`Resetting tutorial progress for user: ${username}`);
        
        // Find the user's progress document
        const progress = await GameProgress.findOne({ Username: username });
        
        if (!progress) {
            console.log(`No progress found for user: ${username}, creating new profile`);
            // Create a new progress document with default "Not Started" state
            const newProgress = new GameProgress({ 
                Username: username,
                tutorial: {
                    status: "Not Started",
                    reward: "",
                    date: new Date(),
                    checkpoints: new Map()
                },
                units: {
                    Unit1: {
                        lessons: {
                            Lesson1: {
                                npcsTalkedTo: []
                            }
                        }
                    }
                }
            });
            
            await newProgress.save();
            
            return res.json({ 
                success: true, 
                message: 'New profile created with reset tutorial progress',
                username: username
            });
        }
        
        // Reset tutorial status
        console.log(`Found progress for ${username}, resetting tutorial data`);
        
        // Initialize checkpoints map if it doesn't exist
        if (!progress.tutorial.checkpoints) {
            progress.tutorial.checkpoints = new Map();
        } else {
            // Clear existing checkpoints
            progress.tutorial.checkpoints.clear();
        }
        
        progress.tutorial.status = "Not Started";
        progress.tutorial.reward = "";
        progress.tutorial.date = new Date();
        
        // Clear NPCs talked to in Unit1/Lesson1
        if (progress.units && 
            progress.units.Unit1 && 
            progress.units.Unit1.lessons && 
            progress.units.Unit1.lessons.Lesson1) {
            
            // Clear the NPC list
            if (!Array.isArray(progress.units.Unit1.lessons.Lesson1.npcsTalkedTo)) {
                progress.units.Unit1.lessons.Lesson1.npcsTalkedTo = [];
            } else {
                progress.units.Unit1.lessons.Lesson1.npcsTalkedTo.length = 0;
            }
        }
        
        // Save the updated document - use markModified to ensure the changes are recognized
        progress.markModified('tutorial.checkpoints'); 
        progress.markModified('units.Unit1.lessons.Lesson1.npcsTalkedTo'); 
        
        await progress.save();
        
        console.log(`Tutorial progress successfully reset for ${username}`);
        res.json({ 
            success: true, 
            message: 'Tutorial progress reset successfully',
            username: username
        });
    } catch (error) {
        console.error('Error resetting tutorial progress:', error);
        res.status(500).json({ 
            error: 'Server error', 
            message: error.message 
        });
    }
});

// NEW ENDPOINT: Get completed NPCs from tutorial
app.get('/api/game_progress/:username/completed_npcs', async (req, res) => {
    try {
        const { username } = req.params;
        console.log(`Fetching completed NPCs for user: ${username}`);
        
        const progress = await GameProgress.findOne({ Username: username });
        
        if (!progress || !progress.tutorial || !progress.tutorial.checkpoints) {
            console.log(`No completed NPCs found for ${username}`);
            return res.json({
                completedNPCs: [],
                count: 0
            });
        }

        // Convert Map to array of NPCs
        const completedNPCs = [];
        progress.tutorial.checkpoints.forEach((value, key) => {
            if (value.status === "Completed") {
                completedNPCs.push({
                    name: key,
                    reward: value.reward || "OneStar",
                    date: value.date,
                    message: value.message
                });
            }
        });

        console.log(`Found ${completedNPCs.length} completed NPCs for ${username}`);
        res.json({
            completedNPCs: completedNPCs,
            count: completedNPCs.length
        });
    } catch (error) {
        console.error(`Error fetching completed NPCs: ${error.message}`);
        res.status(500).json({ 
            error: `Error fetching completed NPCs: ${error.message}`,
            completedNPCs: [],
            count: 0
        });
    }
});

// Update the SaveChoice route
app.post('/api/saveChoice', async (req, res) => {
    try {
        const { username, unit, lesson, sceneName, selectedChoice } = req.body;
        
        // Find the user's progress
        let progress = await GameProgress.findOne({ Username: username });
        
        // If no progress exists, create new progress
        if (!progress) {
            progress = new GameProgress({
                Username: username,
                tutorial: {
                    status: "Not Started",
                    reward: "",
                    date: null
                },
                units: {
                    Unit1: {
                        status: "Not Started",
                        completedLessons: 0,
                        unitScore: 0,
                        lessons: {
                            Lesson1: {
                                status: "Available",
                                reward: "",
                                score: 0,
                                lastAttempt: new Date()
                            }
                        }
                    }
                }
            });
        }

        await progress.save();
        res.json({ message: "Choice saved successfully", progress });
    } catch (error) {
        console.error("Error saving choice:", error);
        res.status(500).json({ error: error.message });
    }
});


//test to postman to get all teachers with pending/approved/rejected status
// Fetch all teachers with pending approval status
app.get('/api/teacher/pending', async (req, res) => {
    try {
        // Find all users with the role "Teacher" and AdminApproval set to "Pending"
        const pendingTeachers = await User.find(
            { 
                Role: 'Teacher', 
                AdminApproval: 'Pending' 
            },
            '-Password' // Exclude the password field for security
        );

        // If no pending teachers are found, return a 404 response
        if (!pendingTeachers || pendingTeachers.length === 0) {
            return res.status(404).json({ message: 'No pending teachers found.' });
        }

        // Return the list of pending teachers
        res.json(pendingTeachers);
    } catch (err) {
        console.error('Error fetching pending teachers:', err);
        res.status(500).json({ error: err.message });
    }
});

// Fetch all teachers with rejected status
app.get('/api/teacher/rejected', async (req, res) => {
    try {
        // Find all users with the role "Teacher" and AdminApproval set to "Rejected"
        const rejectedTeachers = await User.find(
            { 
                Role: 'Teacher', 
                AdminApproval: 'Rejected' 
            },
            '-Password' // Exclude the password field for security
        );

        // If no rejected teachers are found, return a 404 response
        if (!rejectedTeachers || rejectedTeachers.length === 0) {
            return res.status(404).json({ message: 'No rejected found.' });
        }

        // Return the list of rejected teachers
        res.json(rejectedTeachers);
    } catch (err) {
        console.error('Error fetching rejected teachers:', err);
        res.status(500).json({ error: err.message });
    }
});


// Fetch all teachers with approved status
app.get('/api/teacher/approved', async (req, res) => {
    try {
        // Find all users with the role "Teacher" and AdminApproval set to "Rejected"
        const approvedTeachers = await User.find(
            { 
                Role: 'Teacher', 
                AdminApproval: 'Approved' 
            },
            '-Password' // Exclude the password field for security
        );

        // If no approved teachers are found, return a 404 response
        if (!approvedTeachers || approvedTeachers.length === 0) {
            return res.status(404).json({ message: 'No approved found.' });
        }

        // Return the list of rejected teachers
        res.json(approvedTeachers);
    } catch (err) {
        console.error('Error fetching approved teachers:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST route for updating teacher approval status
app.post('/api/teacher/status', async (req, res) => {
    try {
        const { Username, Status } = req.body;
        
        if (!Username || !Status) {
            return res.status(400).json({ error: 'Username and Status are required' });
        }
        
        // Validate status
        if (!['Pending', 'Approved', 'Rejected'].includes(Status)) {
            return res.status(400).json({ error: 'Invalid status value' });
        }
        
        // Update the teacher's status
        const updatedTeacher = await User.findOneAndUpdate(
            { Username: Username, Role: 'Teacher' },
            { $set: { AdminApproval: Status } },
            { new: true }
        );
        
        if (!updatedTeacher) {
            return res.status(404).json({ error: 'Teacher not found' });
        }
        
        res.json({ 
            message: `Teacher status updated to ${Status}`,
            teacher: {
                Username: updatedTeacher.Username,
                FirstName: updatedTeacher.FirstName,
                LastName: updatedTeacher.LastName,
                AdminApproval: updatedTeacher.AdminApproval
            }
        });
    } catch (err) {
        console.error(`Error updating teacher status: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

// Add new dialogue state schema after other schemas
const dialogueStateSchema = new mongoose.Schema({
    Username: { type: String, required: true },
    DialogueId: { type: String, required: true },
    Completed: { type: Boolean, default: true },
    CompletionDate: { type: Date, default: Date.now }
});

// Create a compound index to ensure uniqueness per user/dialogue combination
dialogueStateSchema.index({ Username: 1, DialogueId: 1 }, { unique: true });

const DialogueState = mongoose.model('DialogueState', dialogueStateSchema);

// API endpoint to save dialogue state
app.post('/api/dialogue_state', async (req, res) => {
    try {
        const { Username, DialogueId, Completed } = req.body;
        
        if (!Username || !DialogueId) {
            return res.status(400).send({ error: 'Username and DialogueId are required.' });
        }
        
        console.log(`[DialogueState] Saving state for ${Username}: ${DialogueId} = ${Completed}`);
        
        // Use findOneAndUpdate with upsert to handle both creation and update
        const result = await DialogueState.findOneAndUpdate(
            { Username, DialogueId },
            { Username, DialogueId, Completed, CompletionDate: new Date() },
            { upsert: true, new: true }
        );
        
        res.send({ 
            message: 'Dialogue state saved successfully',
            dialogueId: result.DialogueId,
            completed: result.Completed
        });
    } catch (err) {
        console.error(`Error saving dialogue state: ${err.message}`);
        res.status(500).send({ error: err.message });
    }
});

// API endpoint to check a specific dialogue state
app.get('/api/dialogue_state/:username/:dialogueId', async (req, res) => {
    try {
        const { username, dialogueId } = req.params;
        
        const state = await DialogueState.findOne({ 
            Username: username, 
            DialogueId: dialogueId 
        });
        
        if (!state) {
            return res.send({ completed: false });
        }
        
        res.send({ 
            dialogueId: state.DialogueId,
            completed: state.Completed,
            completionDate: state.CompletionDate
        });
    } catch (err) {
        console.error(`Error retrieving dialogue state: ${err.message}`);
        res.status(500).send({ error: err.message });
    }
});

// API endpoint to get all dialogue states for a user
app.get('/api/dialogue_state/:username', async (req, res) => {
    try {
        const { username } = req.params;
        
        const states = await DialogueState.find({ Username: username });
        
        const stateList = states.map(state => ({
            dialogueId: state.DialogueId,
            completed: state.Completed,
            completionDate: state.CompletionDate
        }));
        
        res.send(stateList);
    } catch (err) {
        console.error(`Error retrieving dialogue states: ${err.message}`);
        res.status(500).send({ error: err.message });
    }
});

// API endpoint to reset/delete a dialogue state
app.delete('/api/dialogue_state/:username/:dialogueId', async (req, res) => {
    try {
        const { username, dialogueId } = req.params;
        
        const result = await DialogueState.findOneAndDelete({ 
            Username: username, 
            DialogueId: dialogueId 
        });
        
        if (!result) {
            return res.status(404).send({ message: 'Dialogue state not found' });
        }
        
        res.send({ message: 'Dialogue state reset successfully' });
    } catch (err) {
        console.error(`Error resetting dialogue state: ${err.message}`);
        res.status(500).send({ error: err.message });
    }
});

// API endpoint to reset all dialogue states for a user
app.delete('/api/dialogue_state/:username', async (req, res) => {
    try {
        const { username } = req.params;
        
        const result = await DialogueState.deleteMany({ Username: username });
        
        if (result.deletedCount === 0) {
            return res.status(404).send({ message: 'No dialogue states found for this user' });
        }
        
        res.send({ message: `Deleted ${result.deletedCount} dialogue states for ${username}` });
    } catch (err) {
        console.error(`Error deleting dialogue states: ${err.message}`);
        res.status(500).send({ error: err.message });
    }
});

// Add new route for direct checkpoint updates to ensure proper structure


app.post('/api/checkpoint_update', async (req, res) => {
    try {
        const { Username, unitId, npcName, reward, status, message, score, totalQuestions, scoreDisplay, lessonId = "PreTest" } = req.body;
        
        if (!Username || !unitId || !npcName) {
            return res.status(400).json({ error: 'Username, unitId, and npcName are required' });
        }

        console.log(`Processing checkpoint update for ${Username}, ${unitId}/${lessonId}, NPC: ${npcName}, score: ${score}/${totalQuestions}`);

        let progress = await GameProgress.findOne({ Username });
        
        if (!progress) {
            progress = new GameProgress({ Username });
        }

        // Create path if needed
        if (!progress.units[unitId]) {
            progress.units[unitId] = {
                status: 'Not Started',
                completedLessons: 0,
                unitScore: 0,
                lessons: {}
            };
        }
        
        if (!progress.units[unitId].lessons) {
            progress.units[unitId].lessons = {};
        }
        
        if (!progress.units[unitId].lessons[lessonId]) {
            progress.units[unitId].lessons[lessonId] = {
                status: 'In Progress',
                reward: '',
                score: 0
            };
        }

        // Use provided scoreDisplay or create one if not provided
        const finalScoreDisplay = scoreDisplay || (totalQuestions ? `${score}/${totalQuestions}` : `${score}`);
        
        // Add the checkpoint
        if (!progress.units[unitId].lessons[lessonId].checkpoints) {
            progress.units[unitId].lessons[lessonId].checkpoints = new Map();
        }

        progress.units[unitId].lessons[lessonId].checkpoints.set(npcName, {
            status: status || 'Completed',
            reward: reward || '',
            date: new Date(),
            message: message || '',
            score: score,
            totalQuestions: totalQuestions || 0,
            scoreDisplay: finalScoreDisplay
        });

        // Special handling for Principal or PrincipalPretest2 to update the parent PreTest score as well
        if (npcName === 'Principal' || npcName === 'PrincipalPretest2') {
            console.log(`Updating PreTest with score=${score}/${totalQuestions} and reward=${reward}`);
            
            // Calculate passed status
            const passed = score >= (totalQuestions / 2);
            
            // Update the PreTest lesson
            progress.units[unitId].lessons[lessonId].score = score;
            progress.units[unitId].lessons[lessonId].totalQuestions = totalQuestions || 0;
            progress.units[unitId].lessons[lessonId].scoreDisplay = finalScoreDisplay;
            progress.units[unitId].lessons[lessonId].reward = reward;
            progress.units[unitId].lessons[lessonId].status = "Completed";
            
            // Update the parent preTest object as well
            if (!progress.units[unitId].preTest) {
                progress.units[unitId].preTest = {
                    status: "Completed",
                    score: score,
                    totalQuestions: totalQuestions || 0,
                    scoreDisplay: finalScoreDisplay,
                    passed: passed,
                    date: new Date()
                };
            } else {
                progress.units[unitId].preTest.status = "Completed";
                progress.units[unitId].preTest.score = score;
                progress.units[unitId].preTest.totalQuestions = totalQuestions || 0;
                progress.units[unitId].preTest.scoreDisplay = finalScoreDisplay;
                progress.units[unitId].preTest.passed = passed;
                progress.units[unitId].preTest.date = new Date();
            }
            
            // Mark all modified fields
            progress.markModified(`units.${unitId}.lessons.${lessonId}`);
            progress.markModified(`units.${unitId}.preTest`);
        }

        // Mark the checkpoints as modified
        progress.markModified(`units.${unitId}.lessons.${lessonId}.checkpoints`);

        // Save changes
        await progress.save();

        res.json({
            message: 'Checkpoint updated successfully',
            scoreDisplay: finalScoreDisplay
        });
    } catch (error) {
        console.error('Error updating checkpoint:', error);
        res.status(500).json({ error: error.message });
    }
});

// Add a debug endpoint to directly examine MongoDB Map storage
app.get('/api/debug_checkpoints/:username/:unitId/:lessonId', async (req, res) => {
    try {
        const { username, unitId, lessonId } = req.params;
        
        // Fetch with debug info
        const progress = await GameProgress.findOne({ Username: username });
        
        if (!progress) {
            return res.status(404).json({ error: 'User progress not found' });
        }
        
        // Check the path
        if (!progress.units?.[unitId]?.lessons?.[lessonId]) {
            return res.status(404).json({ error: `Path units.${unitId}.lessons.${lessonId} not found` });
        }
        
        const lesson = progress.units[unitId].lessons[lessonId];
        
        // Get checkpoints info
        const checkpointsInfo = {
            exists: !!lesson.checkpoints,
            isMap: lesson.checkpoints instanceof Map,
            size: lesson.checkpoints instanceof Map ? lesson.checkpoints.size : 0,
            keys: lesson.checkpoints instanceof Map ? Array.from(lesson.checkpoints.keys()) : [],
            rawValue: lesson.checkpoints
        };
        
        // For response, convert map to object
        const checkpointsObj = {};
        if (lesson.checkpoints instanceof Map) {
            lesson.checkpoints.forEach((value, key) => {
                checkpointsObj[key] = value;
            });
        }
        
        res.json({
            message: 'Debug info for checkpoints',
            checkpointsInfo,
            checkpoints: checkpointsObj,
            lesson: {
                status: lesson.status,
                reward: lesson.reward,
                score: lesson.score
            }
        });
    } catch (error) {
        console.error('Error debugging checkpoints:', error);
        res.status(500).json({ error: error.message });
    }
});

// Add a repair endpoint to fix existing checkpoint issues
app.post('/api/repair_checkpoints/:username', async (req, res) => {
    try {
        const { username } = req.params;
        
        // Fetch user progress
        let progress = await GameProgress.findOne({ Username: username });
        
        if (!progress) {
            return res.status(404).json({ error: 'User progress not found' });
        }
        
        let repaired = false;
        
        // Check and repair Unit1 PreTest
        if (progress.units?.Unit1?.lessons?.PreTest) {
            // Ensure checkpoints exists as a Map
            if (!progress.units.Unit1.lessons.PreTest.checkpoints || 
                !(progress.units.Unit1.lessons.PreTest.checkpoints instanceof Map)) {
                
                progress.units.Unit1.lessons.PreTest.checkpoints = new Map();
                progress.markModified('units.Unit1.lessons.PreTest.checkpoints');
                repaired = true;
            }
            
            // If there's a malformed JSON object called checkpoints, convert to Map
            if (progress.units.Unit1.lessons.PreTest.checkpoints && 
                typeof progress.units.Unit1.lessons.PreTest.checkpoints === 'object' &&
                !(progress.units.Unit1.lessons.PreTest.checkpoints instanceof Map)) {
                
                const checkpointsObj = progress.units.Unit1.lessons.PreTest.checkpoints;
                const checkpointsMap = new Map();
                
                // Convert the object to a Map
                Object.keys(checkpointsObj).forEach(key => {
                    checkpointsMap.set(key, {
                        status: checkpointsObj[key].status || 'Completed',
                        reward: checkpointsObj[key].reward || '',
                        date: checkpointsObj[key].date || new Date(),
                        message: checkpointsObj[key].message || '',
                        score: checkpointsObj[key].score || 0
                    });
                });
                
                progress.units.Unit1.lessons.PreTest.checkpoints = checkpointsMap;
                progress.markModified('units.Unit1.lessons.PreTest.checkpoints');
                repaired = true;
            }
        }
        
        // Check and repair Unit2 PreTest similarly
        if (progress.units?.Unit2?.lessons?.PreTest) {
            // Same repair logic for Unit2
            if (!progress.units.Unit2.lessons.PreTest.checkpoints || 
                !(progress.units.Unit2.lessons.PreTest.checkpoints instanceof Map)) {
                
                progress.units.Unit2.lessons.PreTest.checkpoints = new Map();
                progress.markModified('units.Unit2.lessons.PreTest.checkpoints');
                repaired = true;
            }
            
            // Convert object to Map if needed
            if (progress.units.Unit2.lessons.PreTest.checkpoints && 
                typeof progress.units.Unit2.lessons.PreTest.checkpoints === 'object' &&
                !(progress.units.Unit2.lessons.PreTest.checkpoints instanceof Map)) {
                
                const checkpointsObj = progress.units.Unit2.lessons.PreTest.checkpoints;
                const checkpointsMap = new Map();
                
                Object.keys(checkpointsObj).forEach(key => {
                    checkpointsMap.set(key, {
                        status: checkpointsObj[key].status || 'Completed',
                        reward: checkpointsObj[key].reward || '',
                        date: checkpointsObj[key].date || new Date(),
                        message: checkpointsObj[key].message || '',
                        score: checkpointsObj[key].score || 0
                    });
                });
                
                progress.units.Unit2.lessons.PreTest.checkpoints = checkpointsMap;
                progress.markModified('units.Unit2.lessons.PreTest.checkpoints');
                repaired = true;
            }
        }
        
        if (repaired) {
            await progress.save();
            return res.json({ 
                message: 'Checkpoints repaired successfully',
                username
            });
        } else {
            return res.json({ 
                message: 'No repairs needed',
                username
            });
        }
        
    } catch (error) {
        console.error('Error repairing checkpoints:', error);
        res.status(500).json({ error: error.message });
    }
});

// Add a new endpoint to migrate existing progress data to use checkpoints only
app.post('/api/migrate_pretest_data', async (req, res) => {
    try {
        const { username } = req.body;
        
        if (!username) {
            return res.status(400).json({ error: 'Username is required' });
        }
        
        let progress = await GameProgress.findOne({ Username: username });
        
        if (!progress) {
            return res.status(404).json({ error: 'User progress not found' });
        }
        
        // Check if PreTest data exists
        if (progress.units?.Unit1?.lessons?.PreTest) {
            const preTest = progress.units.Unit1.lessons.PreTest;
            
            // Create checkpoints Map if it doesn't exist
            if (!preTest.checkpoints) {
                preTest.checkpoints = new Map();
            }
            
            // Migrate any npcsTalkedTo to checkpoints if they don't already exist
            if (preTest.npcsTalkedTo && Array.isArray(preTest.npcsTalkedTo)) {
                preTest.npcsTalkedTo.forEach(npcName => {
                    if (!preTest.checkpoints.has(npcName)) {
                        // Create a default checkpoint record
                        preTest.checkpoints.set(npcName, {
                            status: "Completed",
                            reward: "OneStar", // Default reward
                            date: new Date(),
                            message: "Auto-migrated from npcsTalkedTo",
                            score: 5 // Default score
                        });
                    }
                });
            }
            
            // **COMPLETELY REMOVE** npcsTalkedTo array - this is key
            delete preTest.npcsTalkedTo;
            
            // Mark as modified to ensure changes are saved, include the parent field
            progress.markModified('units.Unit1.lessons.PreTest');
            
            // Save changes
            await progress.save();
            
            // Prepare response
            const checkpointsObj = {};
            progress.units.Unit1.lessons.PreTest.checkpoints.forEach((value, key) => {
                checkpointsObj[key] = value;
            });
            
            return res.json({
                message: 'PreTest data migration successful - npcsTalkedTo completely removed',
                checkpoints: checkpointsObj
            });
        }
        
        res.status(404).json({ error: 'No PreTest data found to migrate' });
    } catch (error) {
        console.error('Error migrating PreTest data:', error);
        res.status(500).json({ error: error.message });
    }
});

// Add a new endpoint to completely clean up any remaining npcsTalkedTo arrays
app.post('/api/cleanup_npcstalkedto', async (req, res) => {
    try {
        const { username } = req.body;
        
        // If username is provided, clean just that user
        if (username) {
            const progress = await GameProgress.findOne({ Username: username });
            
            if (!progress) {
                return res.status(404).json({ error: 'User progress not found' });
            }
            
            let modified = false;
            
            // Clean Unit1 PreTest
            if (progress.units?.Unit1?.lessons?.PreTest?.npcsTalkedTo) {
                delete progress.units.Unit1.lessons.PreTest.npcsTalkedTo;
                progress.markModified('units.Unit1.lessons.PreTest');
                modified = true;
            }
            
            // Clean Unit2 PreTest
            if (progress.units?.Unit2?.lessons?.PreTest?.npcsTalkedTo) {
                delete progress.units.Unit2.lessons.PreTest.npcsTalkedTo;
                progress.markModified('units.Unit2.lessons.PreTest');
                modified = true;
            }
            
            if (modified) {
                await progress.save();
                return res.json({ message: `Cleaned up npcsTalkedTo arrays for user: ${username}` });
            } else {
                return res.json({ message: `No npcsTalkedTo arrays found for user: ${username}` });
            }
        }
        
        // Otherwise clean all users
        const bulkWriteOps = [];
        const allProgress = await GameProgress.find({});
        
        for (const progress of allProgress) {
            let modified = false;
            
            // Check Unit1 PreTest
            if (progress.units?.Unit1?.lessons?.PreTest?.npcsTalkedTo) {
                delete progress.units.Unit1.lessons.PreTest.npcsTalkedTo;
                progress.markModified('units.Unit1.lessons.PreTest');
                modified = true;
            }
            
            // Check Unit2 PreTest
            if (progress.units?.Unit2?.lessons?.PreTest?.npcsTalkedTo) {
                delete progress.units.Unit2.lessons.PreTest.npcsTalkedTo;
                progress.markModified('units.Unit2.lessons.PreTest');
                modified = true;
            }
            
            if (modified) {
                await progress.save();
                bulkWriteOps.push(progress.Username);
            }
        }
        
        return res.json({ 
            message: `Cleaned up npcsTalkedTo arrays for ${bulkWriteOps.length} users`,
            users: bulkWriteOps
        });
        
    } catch (error) {
        console.error('Error cleaning up npcsTalkedTo arrays:', error);
        res.status(500).json({ error: error.message });
    }
});

// Add a new endpoint to fix missing fields in PreTest data
app.post('/api/fix_pretest_fields', async (req, res) => {
    try {
        const { Username, unitId, lessonId, totalQuestions, scoreDisplay } = req.body;
        
        if (!Username || !unitId || !lessonId || !totalQuestions) {
            return res.status(400).json({ error: 'Required fields missing' });
        }
        
        console.log(`Fixing missing fields for ${Username}, ${unitId}/${lessonId}, totalQuestions=${totalQuestions}`);
        
        let progress = await GameProgress.findOne({ Username });
        if (!progress) {
            return res.status(404).json({ error: 'User progress not found' });
        }
        
        // Ensure the path exists
        if (!progress.units[unitId] || !progress.units[unitId].lessons || !progress.units[unitId].lessons[lessonId]) {
            return res.status(404).json({ error: `Path units.${unitId}.lessons.${lessonId} not found` });
        }
        
        // Get the existing score value
        const score = progress.units[unitId].lessons[lessonId].score || 0;
        
        // Update fields in the lesson
        progress.units[unitId].lessons[lessonId].totalQuestions = totalQuestions;
        progress.units[unitId].lessons[lessonId].scoreDisplay = scoreDisplay || `${score}/${totalQuestions}`;
        
        // Also update preTest object if it exists
        if (progress.units[unitId].preTest) {
            progress.units[unitId].preTest.totalQuestions = totalQuestions;
            progress.units[unitId].preTest.scoreDisplay = scoreDisplay || `${score}/${totalQuestions}`;
        }
        
        // Update the Principal checkpoint if it exists
        if (progress.units[unitId].lessons[lessonId].checkpoints instanceof Map && 
            progress.units[unitId].lessons[lessonId].checkpoints.has('Principal')) {
            
            const principal = progress.units[unitId].lessons[lessonId].checkpoints.get('Principal');
            principal.totalQuestions = totalQuestions;
            principal.scoreDisplay = scoreDisplay || `${principal.score || score}/${totalQuestions}`;
            
            progress.units[unitId].lessons[lessonId].checkpoints.set('Principal', principal);
            progress.markModified(`units.${unitId}.lessons.${lessonId}.checkpoints`);
        }
        
        // Mark fields as modified
        progress.markModified(`units.${unitId}.lessons.${lessonId}`);
        if (progress.units[unitId].preTest) {
            progress.markModified(`units.${unitId}.preTest`);
        }
        
        await progress.save();
        
        res.json({
            message: 'Fields updated successfully',
            updatedFields: {
                totalQuestions,
                scoreDisplay: scoreDisplay || `${score}/${totalQuestions}`
            }
        });
    } catch (error) {
        console.error('Error fixing fields:', error);
        res.status(500).json({ error: error.message });
    }
});

// New endpoint specifically for updating post test status
app.post('/api/update_post_test', async (req, res) => {
    try {
        console.log("[update_post_test] Received request:", req.body);
        
        const { Username, unitId, newStatus, postTestUpdate } = req.body;
        
        if (!Username || !unitId || !newStatus) {
            return res.status(400).send({ 
                error: 'Missing required fields',
                message: 'Username, unitId, and newStatus are required'
            });
        }
        
        // Find the user's progress document
        const progress = await GameProgress.findOne({ Username });
        
        if (!progress) {
            return res.status(404).send({ 
                error: 'Not found',
                message: `No progress data found for user: ${Username}`
            });
        }
        
        console.log(`[update_post_test] Updating ${unitId} post test status to ${newStatus}`);
        
        // Get the unit
        const unit = progress.units[unitId];
        if (!unit) {
            return res.status(404).send({ 
                error: 'Unit not found',
                message: `Unit ${unitId} not found for user: ${Username}`
            });
        }
        
        // Update the post test status directly
        if (!unit.postTest) {
            unit.postTest = {
                status: newStatus,
                reward: "",
                score: 0,
                totalQuestions: 0,
                scoreDisplay: "",
                checkpoints: {}
            };
        } else {
            unit.postTest.status = newStatus;
        }
        
        // Mark the postTest field as modified to ensure the update is applied
        progress.markModified(`units.${unitId}.postTest`);
        
        // Log the updated object before saving
        console.log(`[update_post_test] Updated post test object:`, unit.postTest);
        
        // Save the changes
        await progress.save();
        
        // Send success response
        res.json({ 
            success: true, 
            message: `${unitId} post test status updated to ${newStatus}`,
            username: Username,
            unitId: unitId,
            postTestStatus: newStatus
        });
    } catch (error) {
        console.error('Error updating post test status:', error);
        res.status(500).json({ 
            error: 'Server error', 
            message: error.message 
        });
    }
});

// New endpoint specifically for updating post test status
app.post('/api/direct_post_test_update', async (req, res) => {
    try {
        const { Username, unitId, reward, score, totalQuestions, scoreDisplay } = req.body;
        
        if (!Username || !unitId) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        
        console.log(`[direct_post_test_update] Updating post test for ${Username}/${unitId}`);
        console.log(`[direct_post_test_update] Data: reward=${reward}, score=${score}, totalQuestions=${totalQuestions}`);
        
        // Find the user's progress
        const progress = await GameProgress.findOne({ Username });
        
        if (!progress) {
            return res.status(404).json({ error: 'User progress not found' });
        }
        
        // Get the unit data
        const unitKey = `units.${unitId}.postTest`;
        
        // Prepare update fields
        const updateFields = {
            [`${unitKey}.status`]: 'Completed',
            [`${unitKey}.score`]: score,
            [`${unitKey}.totalQuestions`]: totalQuestions,
            [`${unitKey}.scoreDisplay`]: scoreDisplay,
            [`${unitKey}.reward`]: reward,
            [`${unitKey}.date`]: new Date()
        };
        
        // Update the document with $set operator
        const result = await GameProgress.updateOne(
            { Username }, 
            { $set: updateFields }
        );
        
        if (result.modifiedCount > 0) {
            console.log(`[direct_post_test_update] Successfully updated post test for ${Username}`);
            res.json({ 
                message: 'Post test data updated successfully',
                updateFields
            });
        } else {
            console.log(`[direct_post_test_update] No changes made to post test for ${Username}`);
            res.json({ 
                message: 'No changes made to post test data',
                updateFields
            });
        }
    } catch (error) {
        console.error(`[direct_post_test_update] Error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

// Similar endpoint but using PUT method for clarity
app.put('/api/post_test/:username/:unitId', async (req, res) => {
    try {
        const { username, unitId } = req.params;
        const { Status, Score, TotalQuestions, ScoreDisplay, Reward, Passed } = req.body;
        
        console.log(`[PUT post_test] Updating post test for ${username}/${unitId}`);
        
        // Find the user's progress
        const progress = await GameProgress.findOne({ Username: username });
        
        if (!progress) {
            return res.status(404).json({ error: 'User progress not found' });
        }
        
        // Make sure the unit exists
        if (!progress.units || !progress.units[unitId]) {
            return res.status(404).json({ error: 'Unit not found' });
        }
        
        // Make sure the postTest object exists
        if (!progress.units[unitId].postTest) {
            progress.units[unitId].postTest = {};
        }
        
        // Update the fields directly
        progress.units[unitId].postTest.status = Status || 'Completed';
        progress.units[unitId].postTest.score = Score || 0;
        progress.units[unitId].postTest.totalQuestions = TotalQuestions || 0;
        progress.units[unitId].postTest.scoreDisplay = ScoreDisplay || '';
        progress.units[unitId].postTest.reward = Reward || '';
        progress.units[unitId].postTest.passed = Passed || false;
        progress.units[unitId].postTest.date = new Date();
        
        // Save the changes
        await progress.save();
        
        res.json({ 
            message: 'Post test updated successfully',
            postTest: progress.units[unitId].postTest
        });
        
    } catch (error) {
        console.error(`[PUT post_test] Error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});


// Add this to your MongoDB server.js file FOR DYNAMIC TABLE TEACHER USER FOR STUDENT UPDATE of INFORMATION
app.put('/api/users/update', async (req, res) => {
    try {
        const { Username, FirstName, LastName, Section, Character, OriginalUsername, Role } = req.body;
        
        if (!OriginalUsername || !Username || !FirstName || !LastName || !Section || !Character) {
            return res.status(400).send({ error: 'Required fields missing.' });
        }

        // Find the user by their original username
        const user = await User.findOne({ Username: OriginalUsername });
        
        if (!user) {
            return res.status(404).send({ error: 'Student not found.' });
        }

        // Update the user data
        user.Username = Username;
        user.FirstName = FirstName;
        user.LastName = LastName;
        user.FullName = `${FirstName} ${LastName}`;
        user.Section = Section;
        user.Character = Character;
        
        // Save the updated user
        await user.save();
        
        res.send({ message: 'Student updated successfully', user });
    } catch (err) {
        console.error('Error updating student:', err);
        res.status(500).send({ error: err.message });
    }
});



// GET route to retrieve rewards (mail) for a user
app.get('/api/rewards/:username', async (req, res) => {
    try {
        const { username } = req.params;
        
        if (!username) {
            return res.status(400).json({ error: 'Username is required' });
        }
        
        // Find the user to get their rewards
        const user = await User.findOne({ Username: username });
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        // Return the rewards array (or empty array if none)
        res.json({
            username: username,
            rewards_collected: user.rewards_collected || []
        });
    } catch (error) {
        console.error('Error retrieving rewards:', error);
        res.status(500).json({ error: error.message });
    }
});

// Add error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ 
        error: 'Server error', 
        message: err.message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
});

// GET route to fetch the full game_progress document for a username
app.get('/api/debug/game_progress/:username', async (req, res) => {
    try {
        const { username } = req.params;

        console.log(`[Debug] Fetching game progress for username: ${username}`);

        // Perform a case-insensitive search for the username
        const progress = await GameProgress.findOne({ Username: { $regex: `^${username}$`, $options: 'i' } });

        if (!progress) {
            console.log(`[Debug] No game progress found for username: ${username}`);
            return res.status(404).json({ error: 'Game progress not found for the specified username.' });
        }

        // Convert checkpoints (if they are Maps) to plain objects for JSON serialization
        const responseData = progress.toObject();
        Object.keys(responseData.units || {}).forEach(unitKey => {
            const unit = responseData.units[unitKey];
            if (unit.lessons) {
                Object.keys(unit.lessons).forEach(lessonKey => {
                    const lesson = unit.lessons[lessonKey];
                    if (lesson.checkpoints instanceof Map) {
                        lesson.checkpoints = Object.fromEntries(lesson.checkpoints);
                    }
                });
            }
        });

        if (responseData.tutorial?.checkpoints instanceof Map) {
            responseData.tutorial.checkpoints = Object.fromEntries(responseData.tutorial.checkpoints);
        }

        res.json(responseData);
    } catch (error) {
        console.error('Error fetching game progress:', error);
        res.status(500).json({ error: 'An error occurred while fetching game progress.', details: error.message });
    }
});

// Add the lesson reset endpoint
app.post('/api/game_progress/:username/lesson_reset', async (req, res) => {
    try {
        const { username } = req.params;
        const { UnitId, LessonId, ResetStatus } = req.body;
        
        if (!UnitId || !LessonId) {
            return res.status(400).json({ 
                error: 'Missing required fields',
                message: 'UnitId and LessonId are required'
            });
        }
        
        console.log(`[lesson_reset] Resetting lesson progress for ${username}, ${UnitId}/${LessonId}`);
        
        // Find the user's progress document
        const progress = await GameProgress.findOne({ Username: username });
        
        if (!progress) {
            return res.status(404).json({ 
                error: 'User progress not found',
                message: `No progress data found for user: ${username}`
            });
        }
        
        // Check if the unit exists
        if (!progress.units[UnitId]) {
            return res.status(404).json({
                error: 'Unit not found', 
                message: `Unit ${UnitId} not found for user: ${username}`
            });
        }
        
        // Check if the lesson exists in this unit
        if (!progress.units[UnitId].lessons[LessonId]) {
            return res.status(404).json({
                error: 'Lesson not found', 
                message: `Lesson ${LessonId} not found in unit ${UnitId} for user: ${username}`
            });
        }
        
        // Get the lesson object
        const lesson = progress.units[UnitId].lessons[LessonId];
        
        // Reset the lesson progress
        if (LessonId === 'PreTest' || LessonId === 'PostTest') {
            // For tests, reset scores and status
            lesson.status = 'Available';
            lesson.score = 0;
            lesson.reward = '';
            lesson.lastAttempt = new Date();
            
            // Clear checkpoints if they exist
            if (lesson.checkpoints instanceof Map) {
                lesson.checkpoints.clear();
            } else if (typeof lesson.checkpoints === 'object') {
                lesson.checkpoints = new Map();
            }
            
            // Also reset parent preTest or postTest if it exists
            if (LessonId === 'PreTest' && progress.units[UnitId].preTest) {
                progress.units[UnitId].preTest.status = 'Available';
                progress.units[UnitId].preTest.score = 0;
                progress.units[UnitId].preTest.passed = false;
                progress.units[UnitId].preTest.date = new Date();
            }
            else if (LessonId === 'PostTest' && progress.units[UnitId].postTest) {
                progress.units[UnitId].postTest.status = 'Available';
                progress.units[UnitId].postTest.score = 0;
                progress.units[UnitId].postTest.passed = false;
                progress.units[UnitId].postTest.date = new Date();
            }
        } 
        else {
            // For regular lessons
            lesson.status = 'Available';
            lesson.lastAttempt = new Date();
            
            // Clear checkpoints if they exist
            if (lesson.checkpoints instanceof Map) {
                lesson.checkpoints.clear();
            } else if (typeof lesson.checkpoints === 'object') {
                lesson.checkpoints = new Map();
            }
            
            // Clear any NPCs talked to lists
            if (Array.isArray(lesson.npcsTalkedTo)) {
                lesson.npcsTalkedTo = [];
            }
        }
        
        // Mark fields as modified to ensure proper saving
        progress.markModified(`units.${UnitId}.lessons.${LessonId}`);
        
        if (LessonId === 'PreTest') {
            progress.markModified(`units.${UnitId}.preTest`);
        }
        else if (LessonId === 'PostTest') {
            progress.markModified(`units.${UnitId}.postTest`);
        }
        
        // Save the changes
        await progress.save();
        
        res.json({
            success: true,
            message: `Reset progress for ${UnitId}/${LessonId}`,
            username: username,
            unitId: UnitId,
            lessonId: LessonId
        });
    } catch (error) {
        console.error(`[lesson_reset] Error: ${error.message}`);
        res.status(500).json({ 
            error: 'Server error', 
            message: error.message 
        });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server running on http://192.168.1.5:${PORT}`);
    // console.log(`Server running on http://192.168.0.227:${PORT}`);

});
