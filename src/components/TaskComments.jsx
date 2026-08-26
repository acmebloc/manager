import Comments from './Comments'

function TaskComments({ projectId, taskId, members }) {
  return <Comments apiPath={`/api/projects/${projectId}/tasks/${taskId}/comments`} members={members} />
}

export default TaskComments
