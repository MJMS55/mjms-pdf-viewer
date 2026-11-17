<?php
declare(strict_types=1);
namespace OCP { interface IRequest {} interface IUserSession { public function getUser(); } }
namespace OCP\Files { interface IRootFolder { public function getUserFolder($uid); } interface File {} }
namespace OCP\AppFramework { class Controller { public function __construct($name, $request) {} } }
namespace OCP\AppFramework\Http { class JSONResponse { public function __construct(public $data, public $status = 200) {} } }
namespace {
require __DIR__ . '/../lib/Controller/RenameController.php';
class Pdf implements \OCP\Files\File {
    public bool $writable = true;
    public string $mime = 'application/pdf';
    public function __construct(public string $name, public $parent) {}
    public function getName() { return $this->name; }
    public function getMimeType() { return $this->mime; }
    public function isUpdateable() { return $this->writable; }
    public function getParent() { return $this->parent; }
    public function getPath() { return '/user/files/PDF/' . $this->name; }
    public function move($path) { return new self(basename($path), $this->parent); }
}
$folder = new class {
    public $file;
    public bool $exists = false;
    public function getById($id) { return $id === 7 ? [$this->file] : []; }
    public function getRelativePath($path) { return substr($path, strlen('/user/files')); }
    public function getPath() { return '/user/files/PDF'; }
    public function nodeExists($name) { return $this->exists; }
};
$folder->file = new Pdf('old.pdf', $folder);
$root = new class($folder) implements \OCP\Files\IRootFolder {
    public function __construct(public $folder) {}
    public function getUserFolder($uid) { if ($uid !== 'user') throw new \Exception('Wrong user'); return $this->folder; }
};
$session = new class implements \OCP\IUserSession {
    public bool $authenticated = true;
    public function getUser() { return $this->authenticated ? new class { public function getUID() { return 'user'; } } : null; }
};
$request = new class implements \OCP\IRequest {};
$controller = new \OCA\MJMSPdfViewer\Controller\RenameController($request, $root, $session);
function check($value, $expected): void { if ($value !== $expected) throw new \Exception(var_export([$value, $expected], true)); }
$response = $controller->rename(7, 'nouveau nom.pdf');
check($response->status, 200);
check($response->data, ['name' => 'nouveau nom.pdf', 'filename' => '/PDF/nouveau nom.pdf']);
foreach (['../bad.pdf', 'sub/bad.pdf', 'sub\\bad.pdf', "bad\0.pdf", 'bad.txt', ''] as $name) check($controller->rename(7, $name)->status, 400);
check($controller->rename(99, 'valid.pdf')->status, 404);
$folder->exists = true; check($controller->rename(7, 'exists.pdf')->status, 409); $folder->exists = false;
$folder->file->writable = false; check($controller->rename(7, 'valid.pdf')->status, 403); $folder->file->writable = true;
$folder->file->mime = 'text/plain'; check($controller->rename(7, 'valid.pdf')->status, 404);
$session->authenticated = false; check($controller->rename(7, 'valid.pdf')->status, 401);
$method = new \ReflectionMethod($controller, 'rename');
foreach ($method->getAttributes() as $attribute) {
    if (str_ends_with($attribute->getName(), 'NoCSRFRequired') || str_ends_with($attribute->getName(), 'PublicPage')) throw new \Exception('Authentication and CSRF must remain enabled');
}
echo "PASS rename, validation, conflicts, permissions, authentication and CSRF\n";
}
