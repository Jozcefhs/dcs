const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const jobDescSchema = new Schema({
    "name": String,
    "tasks": {
        "JSI": [{
            path: {
                type: String,
                required: true
            },
            originalName: {
                type: String,
                required: true
            },
            downloadCount: {
                type: Number,
                required: true,
                default: 0
            }
        }]
    }
})

const tasks = mongoose.model('task', jobDescSchema);

module.exports = tasks;
