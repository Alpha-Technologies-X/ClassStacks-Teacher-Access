// integration.js - Google Sheets integration for ClassStacks
class ClassStacksSheets {
    constructor() {
        // REPLACE THIS WITH YOUR APPS SCRIPT URL
        this.baseUrl = 'https://script.google.com/macros/s/AKfycbxt3E9x8jZc0Yrz-RKmV3SQePc2ogfMQFwQVKM8exkxG0LnFDDpJ-5WGGwqvj6lD8nS/exec';
        this.pollingIntervals = {};
        this.cache = {
            students: {},
            classes: {},
            messages: {},
            activities: {}
        };
    }
    
    // ========== AUTHENTICATION ==========
    
    async registerSchool(name, email, password) {
        const response = await this.makeRequest('registerSchool', {
            name: name,
            email: email,
            password: password
        });
        
        if (response.success) {
            localStorage.setItem('currentUser', JSON.stringify({
                id: response.id,
                name: name,
                email: email,
                role: 'school',
                schoolCode: response.schoolCode
            }));
        }
        
        return response;
    }
    
    async loginSchool(email, password) {
        // For simplicity, we'll store school data locally
        // In a real app, you'd verify against the sheet
        const user = JSON.parse(localStorage.getItem('currentUser') || '{}');
        
        if (user.email === email && user.role === 'school') {
            return user;
        }
        
        throw new Error('Invalid credentials');
    }
    
    async registerTeacher(name, email, password, school) {
        const response = await this.makeRequest('registerTeacher', {
            name: name,
            email: email,
            password: password,
            school: school
        });
        
        if (response.success) {
            localStorage.setItem('currentUser', JSON.stringify({
                id: response.id,
                name: name,
                email: email,
                role: 'teacher',
                school: school
            }));
        }
        
        return response;
    }
    
    async loginTeacher(email, password) {
        const user = JSON.parse(localStorage.getItem('currentUser') || '{}');
        
        if (user.email === email && user.role === 'teacher') {
            return user;
        }
        
        throw new Error('Invalid credentials');
    }
    
    async registerStudent(firstName, lastName, schoolCode) {
        const response = await this.makeRequest('registerStudent', {
            firstName: firstName,
            lastName: lastName,
            schoolCode: schoolCode,
            device: this.getDeviceInfo()
        });
        
        if (response.success) {
            const student = {
                id: response.studentId,
                firstName: firstName,
                lastName: lastName,
                name: `${firstName} ${lastName}`,
                schoolCode: schoolCode,
                classCode: '',
                lastActive: Date.now(),
                device: this.getDeviceInfo(),
                connected: true,
                tabs: [],
                activeTab: 0
            };
            
            localStorage.setItem('currentStudent', JSON.stringify(student));
            this.startStudentPolling(response.studentId);
        }
        
        return response;
    }
    
    // ========== STUDENT MANAGEMENT ==========
    
    async getStudents(schoolCode = null) {
        const params = {};
        if (schoolCode) params.schoolCode = schoolCode;
        
        const response = await this.makeRequest('getStudents', params);
        this.cache.students = response.students.reduce((acc, student) => {
            acc[student.id] = student;
            return acc;
        }, {});
        
        return response.students;
    }
    
    async updateStudentActivity(studentId) {
        return await this.makeRequest('updateStudentActivity', {
            studentId: studentId
        });
    }
    
    async addStudentToClass(studentId, classCode) {
        return await this.makeRequest('addStudentToClass', {
            studentId: studentId,
            classCode: classCode
        });
    }
    
    // ========== CLASS MANAGEMENT ==========
    
    async createClass(name, teacherId, subject, grade, blockedSites = []) {
        return await this.makeRequest('createClass', {
            name: name,
            teacherId: teacherId,
            subject: subject,
            grade: grade,
            blockedSites: blockedSites.join(',')
        });
    }
    
    async getClasses(teacherId = null) {
        const params = {};
        if (teacherId) params.teacherId = teacherId;
        
        const response = await this.makeRequest('getClasses', params);
        this.cache.classes = response.classes.reduce((acc, cls) => {
            acc[cls.id] = cls;
            return acc;
        }, {});
        
        return response.classes;
    }
    
    // ========== MESSAGING ==========
    
    async sendMessageToStudent(studentId, message, from) {
        return await this.makeRequest('sendMessage', {
            studentId: studentId,
            message: message,
            from: from
        });
    }
    
    async getMessages(studentId) {
        const response = await this.makeRequest('getMessages', {
            studentId: studentId
        });
        
        this.cache.messages[studentId] = response.messages;
        return response.messages;
    }
    
    // ========== CONTROLS ==========
    
    async lockStudent(studentId) {
        return await this.makeRequest('lockStudent', {
            studentId: studentId
        });
    }
    
    async unlockStudent(studentId) {
        return await this.makeRequest('unlockStudent', {
            studentId: studentId
        });
    }
    
    // ========== ACTIVITY LOGGING ==========
    
    async logActivity(studentId, action, classCode = '') {
        return await this.makeRequest('logActivity', {
            studentId: studentId,
            action: action,
            classCode: classCode
        });
    }
    
    async getActivity(studentId = null, limit = 100) {
        const params = { limit: limit };
        if (studentId) params.studentId = studentId;
        
        const response = await this.makeRequest('getActivity', params);
        return response.activities;
    }
    
    // ========== REAL-TIME POLLING ==========
    
    startStudentPolling(studentId) {
        if (this.pollingIntervals[studentId]) return;
        
        this.pollingIntervals[studentId] = setInterval(async () => {
            try {
                // Update activity timestamp
                await this.updateStudentActivity(studentId);
                
                // Check for new messages
                const messages = await this.getMessages(studentId);
                const lastMessage = messages[0];
                
                if (lastMessage && !lastMessage.read) {
                    // Trigger message event
                    window.dispatchEvent(new CustomEvent('classstacks:message', {
                        detail: lastMessage
                    }));
                }
                
                // Check if locked
                const students = await this.getStudents();
                const student = students.find(s => s.id === studentId);
                
                if (student && student.locked) {
                    window.dispatchEvent(new CustomEvent('classstacks:locked', {
                        detail: { locked: true }
                    }));
                }
            } catch (error) {
                console.error('Polling error:', error);
            }
        }, 5000); // Poll every 5 seconds
    }
    
    startTeacherPolling(schoolCode) {
        if (this.pollingIntervals['teacher']) return;
        
        this.pollingIntervals['teacher'] = setInterval(async () => {
            try {
                const students = await this.getStudents(schoolCode);
                const classes = await this.getClasses();
                
                // Cache data
                this.cache.students = students.reduce((acc, student) => {
                    acc[student.id] = student;
                    return acc;
                }, {});
                
                this.cache.classes = classes.reduce((acc, cls) => {
                    acc[cls.id] = cls;
                    return acc;
                }, {});
                
                // Trigger update event
                window.dispatchEvent(new CustomEvent('classstacks:update', {
                    detail: {
                        students: students,
                        classes: classes,
                        timestamp: Date.now()
                    }
                }));
            } catch (error) {
                console.error('Teacher polling error:', error);
            }
        }, 3000); // Poll every 3 seconds
    }
    
    stopPolling(key) {
        if (this.pollingIntervals[key]) {
            clearInterval(this.pollingIntervals[key]);
            delete this.pollingIntervals[key];
        }
    }
    
    // ========== HELPER METHODS ==========
    
    async makeRequest(action, params = {}) {
        const url = new URL(this.baseUrl);
        url.searchParams.append('action', action);
        
        Object.keys(params).forEach(key => {
            if (params[key] !== undefined && params[key] !== null) {
                url.searchParams.append(key, params[key]);
            }
        });
        
        try {
            const response = await fetch(url.toString());
            return await response.json();
        } catch (error) {
            console.error('API request failed:', error);
            throw error;
        }
    }
    
    getDeviceInfo() {
        const ua = navigator.userAgent;
        if (/Mobile|Android|iPhone|iPad|iPod/.test(ua)) return 'Mobile';
        if (/Tablet|iPad/.test(ua)) return 'Tablet';
        return 'Desktop';
    }
    
    extractDomain(url) {
        try {
            const domain = new URL(url).hostname;
            return domain.replace('www.', '');
        } catch (e) {
            const match = url.match(/(?:https?:\/\/)?(?:www\.)?([^\/]+)/i);
            return match ? match[1] : url;
        }
    }
    
    getWebsiteName(domain) {
        const names = {
            'google.com': 'Google',
            'youtube.com': 'YouTube',
            'wikipedia.org': 'Wikipedia',
            'khanacademy.org': 'Khan Academy',
            'github.com': 'GitHub',
            'stackoverflow.com': 'Stack Overflow',
            'code.org': 'Code.org',
            'duolingo.com': 'Duolingo',
            'coursera.org': 'Coursera'
        };
        return names[domain] || domain;
    }
    
    getWebsiteIcon(domain) {
        const icons = {
            'google.com': '🔍',
            'youtube.com': '📺',
            'wikipedia.org': '📚',
            'khanacademy.org': '🎓',
            'github.com': '💻',
            'stackoverflow.com': '💡',
            'code.org': '👨‍💻',
            'duolingo.com': '🦉',
            'coursera.org': '🎓'
        };
        return icons[domain] || '🌐';
    }
    
    // Check if student is online (active in last 30 seconds)
    isStudentOnline(student) {
        if (!student || !student.lastActive) return false;
        
        const lastActive = new Date(student.lastActive).getTime();
        return (Date.now() - lastActive) < 30000;
    }
    
    // Get cached data
    getCachedStudents() {
        return Object.values(this.cache.students);
    }
    
    getCachedClasses() {
        return Object.values(this.cache.classes);
    }
    
    getCachedStudent(studentId) {
        return this.cache.students[studentId];
    }
    
    getCachedClass(classId) {
        return this.cache.classes[classId];
    }
}

// Create global instance
window.ClassStacks = new ClassStacksSheets();
