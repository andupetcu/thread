export const mindNode = (text = "Idea", id = "root") => ({
  id,
  type: "mind",
  points: [[0, 0]],
  data: { topic: { children: [{ text }] } },
  children: [],
});
