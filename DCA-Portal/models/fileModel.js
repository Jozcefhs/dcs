const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const fileSchema = new Schema({
    path: {
        type: String,
        required: true
    },
    originalName: {
        type: String,
        required: true
    },
    author: {
        type: String
    },
    activity: {
        type: String
    },
    room: {
        type: String,
        required: true
    },
    downloadCount: {
        type: Number,
        required: true,
        default: 0
    }
}, {timestamps: true})

module.exports = mongoose.model('file', fileSchema);