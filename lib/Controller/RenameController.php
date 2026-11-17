<?php
declare(strict_types=1);
namespace OCA\MJMSPdfViewer\Controller;

use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\JSONResponse;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\Files\IRootFolder;
use OCP\Files\File;
use OCP\IRequest;
use OCP\IUserSession;

class RenameController extends Controller {
    public function __construct(IRequest $request, private IRootFolder $root, private IUserSession $session) {
        parent::__construct('mjms_pdf_viewer', $request);
    }

    #[NoAdminRequired]
    public function rename(int $fileId, string $name): JSONResponse {
        $user = $this->session->getUser();
        if ($user === null) return new JSONResponse(['message' => 'Authentification requise.'], 401);
        $name = trim($name);
        if ($fileId <= 0 || $name === '' || preg_match('/[\\\\\/\x00-\x1f]/', $name) || !preg_match('/\.pdf$/i', $name)) {
            return new JSONResponse(['message' => 'Saisissez un nom valide avec l’extension .pdf.'], 400);
        }
        try {
            $folder = $this->root->getUserFolder($user->getUID());
            $files = $folder->getById($fileId);
            $file = $files[0] ?? null;
            if (!$file instanceof File || $file->getMimeType() !== 'application/pdf') {
                return new JSONResponse(['message' => 'PDF introuvable.'], 404);
            }
            if (!$file->isUpdateable()) return new JSONResponse(['message' => 'Renommage non autorisé.'], 403);
            if ($name !== $file->getName()) {
                $parent = $file->getParent();
                if ($parent->nodeExists($name)) return new JSONResponse(['message' => 'Un fichier porte déjà ce nom.'], 409);
                $file = $file->move($parent->getPath() . '/' . $name);
            }
            return new JSONResponse(['name' => $file->getName(), 'filename' => '/' . ltrim($folder->getRelativePath($file->getPath()), '/')]);
        } catch (\OCP\Files\NotPermittedException $e) {
            return new JSONResponse(['message' => 'Renommage non autorisé.'], 403);
        } catch (\OCP\Files\NotFoundException $e) {
            return new JSONResponse(['message' => 'PDF introuvable.'], 404);
        } catch (\Throwable $e) {
            return new JSONResponse(['message' => 'Impossible de renommer ce PDF.'], 400);
        }
    }
}
