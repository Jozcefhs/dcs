const mongoose = require('mongoose');
const Schema = mongoose.Schema;

//Schema for Bio Data
const bioSchema = new Schema({
    fname: {
        type: String,
        required: true
    },
    uname: {
        type: String,
        required: true
    },
    upass: {
        type: String,
        required: true
    },
    room: {
        type: String,
        required: true
    },
    arm: {
        type: String,
        required: true
    }
}, {timestamps: true})

const user = mongoose.model('junior', bioSchema);

module.exports = user;
