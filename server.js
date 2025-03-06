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


// Updated Game Progress Schema
const gameProgressSchema = new mongoose.Schema({
    Username: { type: String, required: true },
    tutorial: {
        status: { type: String, default: 'Not Started' },
        date: { type: Date },
        // Add checkpoints to track individual NPC completion
        checkpoints: {
            type: Map,
            of: {
                reward: { type: String, default: '' },
                status: { type: String, default: 'Not Completed' },
                date: { type: Date }
            },
            default: new Map()
        }
    },
    units: {
        Unit1: {
            status: { type: String, default: 'Not Started' },
            completedLessons: { type: Number, default: 0 },
            unitScore: { type: Number, default: 0 },
            lessons: {
                Lesson1: {
                    status: { type: String, default: 'Available' },
                    reward: { type: String, default: '' },
                    score: { type: Number, default: 0 },
                    lastAttempt: { type: Date },
                    npcsTalkedTo: { type: [String], default: [] } // Add this field
                },
                Lesson2: {
                    status: { type: String, default: 'Locked' },
                    reward: { type: String, default: '' },
                    score: { type: Number, default: 0 },
                    lastAttempt: { type: Date }
                },
                Lesson3: {
                    status: { type: String, default: 'Locked' },
                    reward: { type: String, default: '' },
                    score: { type: Number, default: 0 },
                    lastAttempt: { type: Date }
                },
                Lesson4: {
                    status: { type: String, default: 'Locked' },
                    reward: { type: String, default: '' },
                    score: { type: Number, default: 0 },
                    lastAttempt: { type: Date }
                },
                Lesson5: {
                    status: { type: String, default: 'Locked' },
                    reward: { type: String, default: '' },
                    score: { type: Number, default: 0 },
                    lastAttempt: { type: Date }
                },
                Lesson6: {
                    status: { type: String, default: 'Locked' },
                    reward: { type: String, default: '' },
                    score: { type: Number, default: 0 },
                    lastAttempt: { type: Date }
                }
            },
            postTest: {
                status: { type: String, default: 'Locked' },
                score: { type: Number, default: 0 },
                completionDate: { type: Date },
                reward: { type: String, default: '' }
            }
        },
        Unit2: {
            status: { type: String, default: 'Not Started' },
            completedLessons: { type: Number, default: 0 },
            unitScore: { type: Number, default: 0 },
            lessons: {
                Lesson1: {
                    status: { type: String, default: 'Available' },
                    reward: { type: String, default: '' },
                    score: { type: Number, default: 0 },
                    lastAttempt: { type: Date }
                },
                Lesson2: {
                    status: { type: String, default: 'Locked' },
                    reward: { type: String, default: '' },
                    score: { type: Number, default: 0 },
                    lastAttempt: { type: Date }
                },
                Lesson3: {
                    status: { type: String, default: 'Locked' },
                    reward: { type: String, default: '' },
                    score: { type: Number, default: 0 },
                    lastAttempt: { type: Date }
                },
                Lesson4: {
                    status: { type: String, default: 'Locked' },
                    reward: { type: String, default: '' },
                    score: { type: Number, default: 0 },
                    lastAttempt: { type: Date }
                },
                Lesson5: {
                    status: { type: String, default: 'Locked' },
                    reward: { type: String, default: '' },
                    score: { type: Number, default: 0 },
                    lastAttempt: { type: Date }
                },
                Lesson6: {
                    status: { type: String, default: 'Locked' },
                    reward: { type: String, default: '' },
                    score: { type: Number, default: 0 },
                    lastAttempt: { type: Date }
                }
            },
            postTest: {
                status: { type: String, default: 'Locked' },
                score: { type: Number, default: 0 },
                completionDate: { type: Date },
                reward: { type: String, default: '' }
            }
        },
        Unit3: {
            status: { type: String, default: 'Not Started' },
            completedLessons: { type: Number, default: 0 },
            unitScore: { type: Number, default: 0 },
            lessons: {
                Lesson1: {
                    status: { type: String, default: 'Available' },
                    reward: { type: String, default: '' },
                    score: { type: Number, default: 0 },
                    lastAttempt: { type: Date }
                },
                Lesson2: {
                    status: { type: String, default: 'Locked' },
                    reward: { type: String, default: '' },
                    score: { type: Number, default: 0 },
                    lastAttempt: { type: Date }
                },
                Lesson3: {
                    status: { type: String, default: 'Locked' },
                    reward: { type: String, default: '' },
                    score: { type: Number, default: 0 },
                    lastAttempt: { type: Date }
                },
                Lesson4: {
                    status: { type: String, default: 'Locked' },
                    reward: { type: String, default: '' },
                    score: { type: Number, default: 0 },
                    lastAttempt: { type: Date }
                },
                Lesson5: {
                    status: { type: String, default: 'Locked' },
                    reward: { type: String, default: '' },
                    score: { type: Number, default: 0 },
                    lastAttempt: { type: Date }
                },
                Lesson6: {
                    status: { type: String, default: 'Locked' },
                    reward: { type: String, default: '' },
                    score: { type: Number, default: 0 },
                    lastAttempt: { type: Date }
                }
            },
            postTest: {
                status: { type: String, default: 'Locked' },
                score: { type: Number, default: 0 },
                completionDate: { type: Date },
                reward: { type: String, default: '' }
            }
        },
        Unit4: {
            status: { type: String, default: 'Not Started' },
            completedLessons: { type: Number, default: 0 },
            unitScore: { type: Number, default: 0 },
            lessons: {
                Lesson1: {
                    status: { type: String, default: 'Available' },
                    reward: { type: String, default: '' },
                    score: { type: Number, default: 0 },
                    lastAttempt: { type: Date }
                },
                Lesson2: {
                    status: { type: String, default: 'Locked' },
                    reward: { type: String, default: '' },
                    score: { type: Number, default: 0 },
                    lastAttempt: { type: Date }
                },
                Lesson3: {
                    status: { type: String, default: 'Locked' },
                    reward: { type: String, default: '' },
                    score: { type: Number, default: 0 },
                    lastAttempt: { type: Date }
                },
                Lesson4: {
                    status: { type: String, default: 'Locked' },
                    reward: { type: String, default: '' },
                    score: { type: Number, default: 0 },
                    lastAttempt: { type: Date }
                },
                Lesson5: {
                    status: { type: String, default: 'Locked' },
                    reward: { type: String, default: '' },
                    score: { type: Number, default: 0 },
                    lastAttempt: { type: Date }
                },
                Lesson6: {
                    status: { type: String, default: 'Locked' },
                    reward: { type: String, default: '' },
                    score: { type: Number, default: 0 },
                    lastAttempt: { type: Date }
                }
            },
            postTest: {
                status: { type: String, default: 'Locked' },
                score: { type: Number, default: 0 },
                completionDate: { type: Date },
                reward: { type: String, default: '' }
            }
        }
    },
    currentUnit: { type: String, default: 'Unit1' },
    currentLesson: { type: String, default: 'Lesson1' }
}, { collection: "game_progress" });

const GameProgress = mongoose.model("GameProgress", gameProgressSchema);

// POST - Save game progress
app.post('/api/game_progress', async (req, res) => {
    try {
        console.log('Received progress update:', JSON.stringify(req.body, null, 2));
        
        const { Username, tutorial, units } = req.body;
        
        if (!Username) {
            return res.status(400).json({ error: 'Username is required' });
        }

        // Find existing progress document
        let progress = await GameProgress.findOne({ Username });
        
        // If no progress exists, create new one
        if (!progress) {
            progress = new GameProgress({ Username });
            
            // Initialize the checkpoints Map if needed
            if (!progress.tutorial.checkpoints) {
                progress.tutorial.checkpoints = new Map();
            }
        }

        // Process tutorial status
        if (tutorial) {
            // Get current time for consistency
            const updateTime = new Date();
            
            // Check NPCs talked to from both incoming request and existing data
            let allNpcsCompleted = [];
            let npcRewards = {};
            
            // Add NPCs from the incoming request and collect their rewards
            if (units && units.Unit1?.lessons?.Lesson1?.npcsTalkedTo) {
                allNpcsCompleted = [...units.Unit1.lessons.Lesson1.npcsTalkedTo];
                
                // If there's a rewards object, capture the rewards data
                if (units.Unit1?.lessons?.Lesson1?.rewards) {
                    npcRewards = units.Unit1.lessons.Lesson1.rewards;
                }
            }
            
            // Add NPCs from existing data if available
            if (progress.units?.Unit1?.lessons?.Lesson1?.npcsTalkedTo) {
                const existingNPCs = progress.units.Unit1.lessons.Lesson1.npcsTalkedTo;
                existingNPCs.forEach(npc => {
                    if (!allNpcsCompleted.includes(npc)) {
                        allNpcsCompleted.push(npc);
                    }
                });
            }
            
            console.log("Combined NPCs from all sources:", allNpcsCompleted);
            console.log("NPC Rewards:", npcRewards);
            
            // Update tutorial checkpoints
            allNpcsCompleted.forEach(npcName => {
                // Get the reward from the incoming data or use existing checkpoint data
                const rewardData = npcRewards[npcName] || tutorial.checkpoints?.[npcName] || { 
                    reward: tutorial.reward || "OneStar",
                    message: "Tutorial Progress"
                };
                
                // Only update if this NPC is newly completed or doesn't have a checkpoint yet
                if (!progress.tutorial.checkpoints.has(npcName) || tutorial.checkpoints?.[npcName]?.reward) {
                    // Use the specific reward for this NPC if available
                    const rewardSprite = rewardData.sprite || rewardData.reward || tutorial.reward || "OneStar";
                    
                    progress.tutorial.checkpoints.set(npcName, {
                        reward: rewardSprite,
                        status: "Completed",
                        date: updateTime,
                        message: rewardData.message || "Tutorial Progress"
                    });
                    console.log(`Added/updated checkpoint for ${npcName} with reward ${rewardSprite}`);
                }
            });
            
            // If both Mark and Annie are in completed list, set tutorial status to "Completed"
            let tutorialStatus = tutorial.status || progress.tutorial.status || "Not Started";
            
            if (allNpcsCompleted.includes('Mark') && allNpcsCompleted.includes('Annie')) {
                tutorialStatus = "Completed";
                console.log("Setting tutorial status to Completed based on NPCs talked to");
            }
            
            // Update tutorial data
            progress.tutorial.status = tutorialStatus;
            progress.tutorial.reward = tutorial.reward || progress.tutorial.reward || "";
            progress.tutorial.date = tutorial.date ? new Date(tutorial.date) : updateTime;
            
            console.log(`Updated tutorial status to: ${tutorialStatus}`);
            console.log("Tutorial checkpoints:", Object.fromEntries(progress.tutorial.checkpoints));
        }

        // Process units data
        if (units) {
            // For each unit in the update
            Object.keys(units).forEach(unitKey => {
                const updatedUnit = units[unitKey];
                
                // If this unit doesn't exist in the DB document, initialize it
                if (!progress.units[unitKey]) {
                    progress.units[unitKey] = {
                        status: updatedUnit.status || "Not Started",
                        completedLessons: updatedUnit.completedLessons || 0,
                        unitScore: updatedUnit.unitScore || 0,
                        lessons: {}
                    };
                }
                
                // Process lessons data
                if (updatedUnit.lessons) {
                    // For each lesson in the update
                    Object.keys(updatedUnit.lessons).forEach(lessonKey => {
                        const updatedLesson = updatedUnit.lessons[lessonKey];
                        
                        // If this lesson doesn't exist in the DB document, initialize it
                        if (!progress.units[unitKey].lessons[lessonKey]) {
                            progress.units[unitKey].lessons[lessonKey] = {
                                status: updatedLesson.status || "Not Started",
                                reward: updatedLesson.reward || "",
                                score: updatedLesson.score || 0,
                                lastAttempt: updatedLesson.lastAttempt ? new Date(updatedLesson.lastAttempt) : new Date(),
                                npcsTalkedTo: []
                            };
                        }
                        
                        // Handle NPCs talked to - this is the key part we need to fix
                        if (updatedLesson.npcsTalkedTo && Array.isArray(updatedLesson.npcsTalkedTo)) {
                            // Get existing NPCs from the database
                            let existingNPCs = progress.units[unitKey].lessons[lessonKey].npcsTalkedTo || [];
                            
                            // Create a Set to eliminate duplicates
                            const uniqueNPCs = new Set([...existingNPCs]);
                            
                            // Add the new NPCs to the Set
                            updatedLesson.npcsTalkedTo.forEach(npc => {
                                uniqueNPCs.add(npc);
                            });
                            
                            // Convert Set back to array
                            progress.units[unitKey].lessons[lessonKey].npcsTalkedTo = [...uniqueNPCs];
                            
                            console.log(`Updated NPCs talked to for ${unitKey} ${lessonKey}: `, 
                                progress.units[unitKey].lessons[lessonKey].npcsTalkedTo);
                        }
                        
                        // Update other lesson fields if provided
                        if (updatedLesson.status) 
                            progress.units[unitKey].lessons[lessonKey].status = updatedLesson.status;
                        if (updatedLesson.reward)
                            progress.units[unitKey].lessons[lessonKey].reward = updatedLesson.reward;
                        if (updatedLesson.score)
                            progress.units[unitKey].lessons[lessonKey].score = updatedLesson.score;
                        if (updatedLesson.lastAttempt)
                            progress.units[unitKey].lessons[lessonKey].lastAttempt = new Date(updatedLesson.lastAttempt);
                    });
                }
                
                // Update unit-level fields if provided
                if (updatedUnit.status)
                    progress.units[unitKey].status = updatedUnit.status;
                if (updatedUnit.completedLessons !== undefined)
                    progress.units[unitKey].completedLessons = updatedUnit.completedLessons;
                if (updatedUnit.unitScore !== undefined)
                    progress.units[unitKey].unitScore = updatedUnit.unitScore;
            });
        }

        // Save the updated document
        await progress.save();
        
        // Convert Map to plain object for JSON response
        const checkpointObjects = {};
        progress.tutorial.checkpoints.forEach((value, key) => {
            checkpointObjects[key] = value;
        });
        
        res.json({ 
            message: 'Progress saved successfully', 
            tutorial: {
                status: progress.tutorial.status,
                reward: progress.tutorial.reward,
                date: progress.tutorial.date,
                checkpoints: checkpointObjects
            },
            npcsTalkedTo: progress.units.Unit1.lessons.Lesson1.npcsTalkedTo
        });
    } catch (error) {
        console.error('Error saving progress:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET - Fetch user progress
app.get('/api/game_progress/:username', async (req, res) => {
    try {
        const { username } = req.params;
        const progress = await GameProgress.findOne({ Username: username });

        if (!progress) {
            return res.json({
                Username: username,
                tutorial: { status: "Not Started", reward: "", date: null },
                lessons: {}
            });
        }

        res.json(progress);
    } catch (error) {
        console.error('Error fetching game progress:', error);
        res.status(500).json({ message: 'Server error' });
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

// Add error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ 
        error: 'Server error', 
        message: err.message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server running on http://192.168.1.11:${PORT}`);
});
