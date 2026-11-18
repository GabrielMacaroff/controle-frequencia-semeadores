'use strict';

const allowedMarks = new Set(['presente', 'ausente']);

function isValidAttendance(submitted, students) {
  const studentIds = new Set(students.map(student => student.id));
  const marks = Object.entries(submitted);

  return studentIds.size > 0
    && marks.length === studentIds.size
    && marks.every(([id, mark]) => studentIds.has(id) && allowedMarks.has(mark));
}

module.exports = { isValidAttendance };
