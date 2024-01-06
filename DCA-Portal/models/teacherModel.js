const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const teacher = new Schema({
    uid: String,
    fname: String,
    roles: Object
});

module.exports = mongoose.model('teacher', teacher);